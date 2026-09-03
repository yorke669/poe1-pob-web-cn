#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将天赋树翻译 CSV 合并为 data/translations.js，暴露全局 window.POE1_TREE_TR 字典。

源 CSV (data/translations/):
  tree_dn.csv      节点显示名 (name 表)
  tree_sd.csv      词缀描述行 (stat 表, 具体数值写死)
  statDescriptions.csv  官方占位翻译 (stat 表, 用 {0} 代替数值, 后加载覆盖同名项)
  tree_rt.csv      提醒文本 (reminder 表)
  passiveTree.csv  提醒/升华描述 (reminder 表, 与 tree_rt 合并)

用法: python3 build_translations.py
"""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "translations")
OUT = os.path.join(HERE, "data", "translations.js")


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
    print("  %-18s -> %d 条" % (os.path.basename(path), len(d)))
    return d


def main():
    dn = load(os.path.join(SRC, "tree_dn.csv"))
    sd = load(os.path.join(SRC, "tree_sd.csv"))
    sd2 = load(os.path.join(SRC, "statDescriptions.csv"))  # 官方 {0} 占位翻译
    sd.update(sd2)  # statDescriptions 覆盖 tree_sd 同名键
    rt = load(os.path.join(SRC, "tree_rt.csv"))
    rt2 = load(os.path.join(SRC, "passiveTree.csv"))
    rt.update(rt2)  # passiveTree 覆盖 tree_rt 同名键

    TR = {"name": dn, "stat": sd, "reminder": rt}
    js = "window.POE1_TREE_TR = " + json.dumps(TR, ensure_ascii=False) + ";\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print("写出:", OUT, "( %.1f KB )" % (len(js.encode("utf-8")) / 1024))


if __name__ == "__main__":
    main()
