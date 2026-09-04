#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将天赋树 / 军团珠宝翻译 CSV 合并为 data/translations.js，暴露全局 window.POE1_TREE_TR 字典。

源 CSV (data/translations/):
  tree_dn.csv      节点显示名 (name 表)
  tree_sd.csv      词缀描述行 (stat 表, 具体数值写死)
  statDescriptions.csv  官方占位翻译 (stat 表, 用 {0} 代替数值, 后加载覆盖同名项)
  tree_rt.csv      提醒文本 (reminder 表)
  passiveTree.csv  提醒/升华描述 (reminder 表, 与 tree_rt 合并)
  Items_Jewels.txt.csv  珠宝/传奇珠宝名 (jewel 表)
  TreeTab.csv      军团珠宝「征服者 (基石)」行 (jewel 表, 同时产出征服者名与基石名)
  timeless.csv     军团珠宝手工补译 (jewel 表, 覆盖同名项)

用法: python3 build_translations.py
"""
import csv
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "translations")
OUT = os.path.join(HERE, "data", "translations.js")

# TreeTab.csv 里军团珠宝相关行形如：  Xibaqua (Divine Flesh),夏巴夸亚（神圣血肉）
CONQ_RE = re.compile(r"^([A-Z][\w'’\- ]*?) \((.+)\)$")
CONQ_ZH_RE = re.compile(r"^(.+?)（(.+)）$")


def load(path):
    d = {}
    if not os.path.exists(path):
        print("[warn] 缺失:", path)
        return d
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 2:
                continue
            en = row[0].strip()
            zh = row[1].strip()
            if not en:
                continue
            d[en] = zh
    print("  %-24s -> %d 条" % (os.path.basename(path), len(d)))
    return d


def load_jewel():
    """军团珠宝表：珠宝名 + 征服者名 + 征服者基石名。

    顺序即优先级，后面的覆盖前面的：
      1) Items_Jewels.txt.csv  珠宝（含 6 颗军团珠宝）
      2) TreeTab.csv           「征服者 (基石)」行，一份数据拆出征服者名与基石名
      3) timeless.csv          手工补译（TreeTab 里没有的征服者）
    """
    d = load(os.path.join(SRC, "Items_Jewels.txt.csv"))

    tree_tab = os.path.join(SRC, "TreeTab.csv")
    n_conq = n_ks = 0
    if os.path.exists(tree_tab):
        with open(tree_tab, encoding="utf-8", newline="") as f:
            for row in csv.reader(f):
                if len(row) < 2:
                    continue
                m = CONQ_RE.match(row[0].strip())
                if not m:
                    continue
                zh = CONQ_ZH_RE.match(row[1].strip())
                if not zh:
                    continue
                d[m.group(1)] = zh.group(1)      # Xibaqua      -> 夏巴夸亚
                d[m.group(2)] = zh.group(2)      # Divine Flesh -> 神圣血肉
                n_conq += 1
                n_ks += 1
        print("  %-24s -> 征服者 %d / 基石 %d 条" % ("TreeTab.csv(解析)", n_conq, n_ks))

    d.update(load(os.path.join(SRC, "timeless.csv")))
    return d


def main():
    dn = load(os.path.join(SRC, "tree_dn.csv"))
    sd = load(os.path.join(SRC, "tree_sd.csv"))
    sd2 = load(os.path.join(SRC, "statDescriptions.csv"))  # 官方 {0} 占位翻译
    sd.update(sd2)  # statDescriptions 覆盖 tree_sd 同名键
    rt = load(os.path.join(SRC, "tree_rt.csv"))
    rt2 = load(os.path.join(SRC, "passiveTree.csv"))
    rt.update(rt2)  # passiveTree 覆盖 tree_rt 同名键
    jewel = load_jewel()

    TR = {"name": dn, "stat": sd, "reminder": rt, "jewel": jewel}
    js = "window.POE1_TREE_TR = " + json.dumps(TR, ensure_ascii=False) + ";\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print("写出:", OUT, "( %.1f KB )" % (len(js.encode("utf-8")) / 1024))


if __name__ == "__main__":
    main()
