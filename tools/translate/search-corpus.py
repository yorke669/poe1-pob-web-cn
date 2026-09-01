#!/usr/bin/env python3
"""Search the PoeCharm translation corpus for given English text.

Determines, for each query, whether a translation entry exists in the corpus
and in which CSV file. Reports match type:
  EXACT   = a CSV key equals the query (runtime DrawString text would hit)
  SUBSTR  = a CSV key contains the query as substring (template/partial match)

Usage:
    python3 tools/translate/search-corpus.py [corpusDir] [queryFile|-]

With no args it searches the default corpus (PoeCharm zh-rCN) using the
built-in queries taken from the "skill gem tooltip not translated" screenshot.
Pass "-" to read queries (one per line) from stdin.
"""

import csv
import sys
from pathlib import Path

DEFAULT_CORPUS = Path("/opt/poe/PoeCharm/Data/Translate/zh-rCN")

# Built-in queries: every untranslated fragment seen in the skill-gem tooltip
# screenshot (gem description paragraph + stat compare lines + header).
BUILTIN_QUERIES = [
    # gem description (full sentence, in case a whole-text key exists)
    "Strikes enemies in front of you with a surge of flame.",
    # gem description fragments
    "Strikes enemies in front of you",
    "Burning enemies are dealt more damage",
    "burning ground under them",
    "Your damage modifiers",
    # header (renders translated in the screenshot)
    "Selecting this gem will give you:",
    # stat compare line labels (from BuildDisplayStats.lua / SkillsTab.lua)
    "Average Hit",
    "Average Damage",
    "Attack Rate",
    "Crit Chance",
    "Hit Chance",
    "Hit DPS",
    "AoE Radius",
    "Mana Cost",
    "Mana Cost per second",
]


def search_csv(csv_path: Path, queries: list[str]):
    """Yield (query, line_no, key, value, match_type) hits in one CSV."""
    try:
        fh = open(csv_path, "r", encoding="utf-8-sig", newline="")
    except OSError as e:
        print(f"  !! cannot open {csv_path}: {e}", file=sys.stderr)
        return
    with fh:
        for line_no, row in enumerate(csv.reader(fh), 1):
            if len(row) < 2:
                continue
            key = row[0].strip()
            if not key:
                continue
            key_l = key.lower()
            for q in queries:
                q_l = q.lower()
                if key_l == q_l:
                    yield line_no, key, row[1], "EXACT"
                elif q_l in key_l:
                    yield line_no, key, row[1], "SUBSTR"


def main() -> int:
    corpus = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CORPUS
    if len(sys.argv) > 2:
        src = sys.stdin if sys.argv[2] == "-" else open(sys.argv[2], encoding="utf-8")
        queries = [line.strip() for line in src if line.strip()]
    else:
        queries = BUILTIN_QUERIES

    if not corpus.is_dir():
        print(f"Corpus directory not found: {corpus}", file=sys.stderr)
        return 1

    csv_files = sorted(corpus.rglob("*.csv"))
    print(f"Corpus: {corpus} ({len(csv_files)} CSV files)\n")

    for q in queries:
        hits = []
        for f in csv_files:
            for line_no, key, value, mtype in search_csv(f, [q]):
                hits.append((mtype, f.name, line_no, key, value))
        if not hits:
            print(f"[MISS    ] {q!r}")
            print("    -> no key in any CSV contains this text")
            continue
        exact = [h for h in hits if h[0] == "EXACT"]
        substr = [h for h in hits if h[0] == "SUBSTR"]
        tag = "EXACT   " if exact else "SUBSTR  "
        print(f"[{tag}] {q!r}  ({len(exact)} exact, {len(substr)} substring)")
        for mtype, fname, line_no, key, value in (exact + substr)[:6]:
            key_show = key if len(key) <= 70 else key[:67] + "..."
            val_show = value if len(value) <= 40 else value[:37] + "..."
            print(f"    {fname}:{line_no} [{mtype}] {key_show!r} -> {val_show!r}")
        if len(substr) > 6 and not exact:
            print(f"    ... and {len(substr) - 6} more substring hits")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
