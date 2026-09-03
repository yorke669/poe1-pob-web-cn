#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Vilsol/timeless-jewels（Go, MIT）的 data/embedded/*.json.gz 生成
poe1-passive-tree/data/timeless-data.js（window.POE1_TIMELESS）。

军团珠宝的计算是按种子实时算的（TinyMT32），不需要 pobzh 那种几百 MB 的预计算 LUT，
只需要 4 张游戏数据表 + 裁剪后的词条文本。本脚本负责抽表、裁剪、写成页面可直接 <script> 引入的 JS。

用法：
    python3 build_timeless_data.py \
        --src /opt/poe/timeless-jewels/data/embedded \
        --tree-dir . \
        --out data/timeless-data.js
"""

import argparse
import gzip
import json
import os
import re
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------- 常量（来自 data/jewels.go）

JEWELS = {
    1: "Glorious Vanity",
    2: "Lethal Pride",
    3: "Brutal Restraint",
    4: "Militant Faith",
    5: "Elegant Hubris",
    6: "Heroic Tragedy",
}

# 征服者 -> (ConquerorIndex, ConquerorVersion)
CONQUERORS = {
    1: [("Xibaqua", 1, 0), ("Zerphi", 2, 0), ("Ahuana", 2, 1), ("Doryani", 3, 0)],
    2: [("Kaom", 1, 0), ("Rakiata", 2, 0), ("Kiloava", 3, 0), ("Akoya", 3, 1)],
    3: [("Deshret", 1, 0), ("Balbala", 1, 1), ("Asenath", 2, 0), ("Nasima", 3, 0)],
    4: [("Venarius", 1, 0), ("Maxarius", 1, 1), ("Dominus", 2, 0), ("Avarius", 3, 0)],
    5: [("Cadiro", 1, 0), ("Victario", 2, 0), ("Chitus", 3, 0), ("Caspiro", 3, 1)],
    6: [("Vorana", 1, 0), ("Uhtred", 2, 0), ("Medved", 3, 0)],
}

# (min, max, step)；step>1 时真实种子 = 循环变量 * step（优雅狂妄）
SEED_RANGES = {
    1: (100, 8000, 1),
    2: (10000, 18000, 1),
    3: (500, 8000, 1),
    4: (2000, 10000, 1),
    5: (2000, 160000, 20),
    6: (100, 8000, 1),
}

# ---------------------------------------------------------------- 工具

def read_gz_json(path):
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def load_tree_node_ids(tree_dir):
    """从 poe1-tree*.js 里取出天赋树节点 id 集合（多个数据源取并集）。"""
    ids = set()
    if not os.path.isdir(tree_dir):
        return ids
    for name in sorted(os.listdir(tree_dir)):
        if not (name.startswith("poe1-tree") and name.endswith(".js")):
            continue
        path = os.path.join(tree_dir, name)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read(4 * 1024 * 1024)
        m = re.search(r"window\.POE1_TREE\s*=\s*", text)
        if not m:
            continue
        try:
            tree = json.JSONDecoder().raw_decode(text, m.end())[0]
        except ValueError as e:
            print("  跳过 %s（解析失败：%s）" % (name, e), file=sys.stderr)
            continue
        for k in (tree.get("nodes") or {}):
            try:
                ids.add(int(k))
            except ValueError:
                pass
        print("  %s -> %d 节点" % (name, len(ids)))
    return ids


def flags_of(skill):
    """1=keystone 2=notable 4=jewelSocket（与 PassiveSkillType 判断顺序一致）"""
    f = 0
    if skill.get("IsKeystone"):
        f |= 1
    if skill.get("IsNotable"):
        f |= 2
    if skill.get("IsJewelSocket"):
        f |= 4
    return f


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/opt/poe/timeless-jewels/data/embedded",
                    help="timeless-jewels 的 data/embedded 目录")
    ap.add_argument("--tree-dir", default=".", help="poe1-tree*.js 所在目录（用于裁剪 passives）")
    ap.add_argument("--out", default="data/timeless-data.js", help="输出 JS 文件")
    ap.add_argument("--src-commit", default="", help="源仓库 commit，仅记录用")
    args = ap.parse_args()

    print("读取源表：%s" % args.src)
    passives_raw = read_gz_json(os.path.join(args.src, "passive_skills.json.gz"))
    alt_skills_raw = read_gz_json(os.path.join(args.src, "alternate_passive_skills.json.gz"))
    alt_adds_raw = read_gz_json(os.path.join(args.src, "alternate_passive_additions.json.gz"))
    tree_ver_raw = read_gz_json(os.path.join(args.src, "alternate_tree_versions.json.gz"))
    stats_raw = read_gz_json(os.path.join(args.src, "stats.json.gz"))
    possible_stats = read_gz_json(os.path.join(args.src, "possible_stats.json.gz"))
    print("  passives=%d altSkills=%d altAdditions=%d treeVersions=%d stats=%d"
          % (len(passives_raw), len(alt_skills_raw), len(alt_adds_raw),
             len(tree_ver_raw), len(stats_raw)))

    print("读取天赋树节点 id：%s" % args.tree_dir)
    tree_ids = load_tree_node_ids(args.tree_dir)
    if not tree_ids:
        print("  警告：没有取到任何树节点 id，passives 将不做裁剪", file=sys.stderr)

    # ---- passives：只保留树上看得见的节点 ----
    passives = []
    for p in passives_raw:
        gid = int(p.get("PassiveSkillGraphId") or 0)
        if tree_ids and gid not in tree_ids:
            continue
        passives.append([
            int(p["_key"]),
            gid,
            flags_of(p),
            [int(s) for s in (p.get("Stats") or [])],
        ])
    passives.sort(key=lambda x: x[0])

    # ---- altSkills / altAdditions 全量保留（各几百条）----
    alt_skills = []
    for a in alt_skills_raw:
        alt_skills.append({
            "i": int(a["_key"]),
            "n": a.get("Name") or "",
            "v": int(a.get("AlternateTreeVersionsKey") or 0),
            "t": [int(x) for x in (a.get("PassiveType") or [])],
            "k": [int(x) for x in (a.get("StatsKeys") or [])],
            "s": [int(a.get("Stat1Min") or 0), int(a.get("Stat1Max") or 0),
                  int(a.get("Stat2Min") or 0), int(a.get("Stat2Max") or 0),
                  int(a.get("Var9") or 0), int(a.get("Var10") or 0),
                  int(a.get("Var11") or 0), int(a.get("Var12") or 0)],
            "w": int(a.get("SpawnWeight") or 0),
            "ci": int(a.get("Var18") or 0),   # ConquerorIndex
            "cv": int(a.get("Var24") or 0),   # ConquerorVersion
            "rm": int(a.get("RandomMin") or 0),
            "rM": int(a.get("RandomMax") or 0),
        })

    alt_adds = []
    for a in alt_adds_raw:
        alt_adds.append({
            "i": int(a["_key"]),
            "v": int(a.get("AlternateTreeVersionsKey") or 0),
            "w": int(a.get("SpawnWeight") or 0),
            "k": [int(x) for x in (a.get("StatsKeys") or [])],
            "s": [int(a.get("Stat1Min") or 0), int(a.get("Stat1Max") or 0),
                  int(a.get("Var6") or 0), int(a.get("Var7") or 0)],
            "t": [int(x) for x in (a.get("PassiveType") or [])],
        })

    tree_versions = []
    for v in tree_ver_raw:
        tree_versions.append({
            "i": int(v["_key"]),
            "id": v.get("Id") or "",
            "sa": bool(v.get("Var1")),   # AreSmallAttributePassiveSkillsReplaced
            "sn": bool(v.get("Var2")),   # AreSmallNormalPassiveSkillsReplaced
            "mn": int(v.get("Var5") or 0),  # MinimumAdditions
            "mx": int(v.get("Var6") or 0),  # MaximumAdditions
            "nw": int(v.get("Var9") or 0),  # NotableReplacementSpawnWeight
        })

    # ---- 被引用的 stat id 集合：只带这些 stat 的文本与翻译 ----
    needed = set()
    for a in alt_skills:
        needed.update(a["k"])
    for a in alt_adds:
        needed.update(a["k"])
    for _, m in (possible_stats or {}).items():
        for sid in m:
            needed.add(int(sid))

    stats = {}
    id_to_index = {}
    for s in stats_raw:
        idx = int(s["_key"])
        if idx in needed:
            sid = s.get("Id") or ""
            stats[str(idx)] = [sid, s.get("Text") or ""]
            if sid:
                id_to_index[sid] = idx

    # ---- 词条翻译：3 个 description 文件按 vilsol 的优先级合并（先出现者胜）----
    translations = {}
    want_ids = set(id_to_index.keys())
    for fname in ("stat_descriptions.json.gz",
                  "passive_skill_stat_descriptions.json.gz",
                  "passive_skill_aura_stat_descriptions.json.gz"):
        path = os.path.join(args.src, fname)
        if not os.path.exists(path):
            continue
        doc = read_gz_json(path)
        for desc in (doc.get("descriptors") or []):
            for sid in (desc.get("ids") or []):
                if sid in want_ids and sid not in translations:
                    lst = []
                    for item in (desc.get("list") or []):
                        cond = None
                        conds = item.get("conditions") or []
                        if conds:
                            c = conds[0]
                            cond = [c.get("min"), c.get("max"), bool(c.get("negated"))]
                        ih = item.get("index_handlers")
                        handlers = None
                        if isinstance(ih, list):
                            if ih and isinstance(ih[0], list):
                                handlers = [str(x) for x in ih[0]]
                        elif isinstance(ih, dict):
                            handlers = [str(x) for x in ih.keys()]
                        lst.append([item.get("string") or "", cond, handlers])
                    translations[sid] = lst

    data = {
        "meta": {
            "treeVersion": "3_29",
            "source": "Vilsol/timeless-jewels (MIT)",
            "srcCommit": args.src_commit,
            "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": {
                "passives": len(passives),
                "altSkills": len(alt_skills),
                "altAdditions": len(alt_adds),
                "stats": len(stats),
                "translations": len(translations),
            },
        },
        "jewels": {str(k): v for k, v in JEWELS.items()},
        "conquerors": {str(k): [n for n, _, _ in v] for k, v in CONQUERORS.items()},
        "conquerorIdx": {
            str(k): {n: [ci, cv] for n, ci, cv in v} for k, v in CONQUERORS.items()
        },
        "seedRanges": {str(k): list(v) for k, v in SEED_RANGES.items()},
        "treeVersions": tree_versions,
        "passives": passives,
        "altSkills": alt_skills,
        "altAdditions": alt_adds,
        "stats": stats,
        "translations": translations,
        "possibleStats": {str(k): {str(a): int(b) for a, b in v.items()}
                          for k, v in (possible_stats or {}).items()},
    }

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("/* 自动生成，请勿手改。\n"
                " * 源：Vilsol/timeless-jewels data/embedded（3_29）\n"
                " * 重新生成：python3 build_timeless_data.py --src /opt/poe/timeless-jewels/data/embedded\n"
                " * passives: [index, PassiveSkillGraphId, flags(1基石/2中点/4插槽), [statIndex...]]\n"
                " */\n")
        # 同时挂载到 window 与 self，使主线程与 Web Worker 都能直接 importScripts 本文件
        f.write("var __TJ_G__ = (typeof window !== 'undefined') ? window\n"
                "              : (typeof self !== 'undefined' ? self : this);\n")
        f.write("__TJ_G__.POE1_TIMELESS = ")
        f.write(body)
        f.write(";\n")

    size = os.path.getsize(args.out)
    print("输出：%s（%.1f KB）" % (args.out, size / 1024.0))
    print("  passives %d（源 %d）· altSkills %d · altAdditions %d · stats %d · translations %d"
          % (len(passives), len(passives_raw), len(alt_skills), len(alt_adds),
             len(stats), len(translations)))
    miss = len(needed) - len(stats)
    if miss:
        print("  注意：%d 个被引用的 stat index 在 stats.json 中不存在（正常，多为已废弃条目）" % miss)


if __name__ == "__main__":
    main()
