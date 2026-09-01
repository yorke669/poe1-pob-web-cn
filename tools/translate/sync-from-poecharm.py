#!/usr/bin/env python3
"""
Sync PoeCharm zh-rCN CSV translations into per-file Lua modules.

This keeps a 1:1 mapping with PoeCharm source CSV files (one .lua per .csv)
so coverage can be checked file-by-file. It also writes translate_manifest.lua,
which boot.lua uses to load and merge all modules at runtime.

Usage:
    python3 tools/translate/sync-from-poecharm.py [sourceDir] [outputDir]

Environment:
    POECHARM_TRANSLATE_DIR  override default source directory
"""

import argparse
import csv
import os
import re
import sys
from pathlib import Path
from typing import List, Tuple

DEFAULT_SOURCE = os.environ.get(
    "POECHARM_TRANSLATE_DIR",
    "/Users/xingyuke/Windows/code/ai/POE/PoeCharm/Data/Translate/zh-rCN",
)
SCRIPT_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_OUTPUT = WORKSPACE_ROOT / "packages" / "driver" / "translate"
MANIFEST_NAME = "translate_manifest.lua"


def strip_escapes(text: str) -> str:
    """Strip PoB colour/format escape codes so keys match runtime strings."""
    text = re.sub(r"\^x[0-9a-fA-F]{6}", "", text)
    text = re.sub(r"\^[0-9]", "", text)
    return text


def lua_string(text: str) -> str:
    """Escape a string for use as a double-quoted Lua string."""
    text = text.replace("\\", "\\\\")
    text = text.replace('"', '\\"')
    text = text.replace("\n", "\\n")
    text = text.replace("\r", "\\r")
    text = text.replace("\t", "\\t")
    return f'"{text}"'


def process_csv(csv_path: Path, source_dir: Path, output_dir: Path) -> Tuple[str, int]:
    rel = csv_path.relative_to(source_dir)
    lua_rel = rel.with_suffix(".lua")
    output_path = output_dir / lua_rel
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rows: List[Tuple[str, str]] = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 2:
                continue
            key, value = row[0], row[1]
            key = strip_escapes(key)
            if not key:
                continue
            rows.append((key, value))

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("-- Auto-generated from PoeCharm translation CSV.\n")
        f.write("-- Do not edit manually; run tools/translate/sync-from-poecharm.py.\n")
        f.write("return {\n")
        for key, value in rows:
            f.write(f"  [{lua_string(key)}] = {lua_string(value)},\n")
        f.write("}\n")

    # The Lua filename keeps the original CSV basename (e.g. Gems_data.txt.lua)
    # so coverage can be compared file-by-file. boot.lua loads it directly via
    # loadfile, which avoids Lua's require splitting dots into path components.
    return lua_rel.as_posix(), len(rows)


def clean_output(output_dir: Path) -> None:
    """Remove previously generated .lua files so stale modules don't linger."""
    if not output_dir.exists():
        return
    for lua_file in output_dir.rglob("*.lua"):
        lua_file.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync PoeCharm translations to per-file Lua modules."
    )
    parser.add_argument("source", nargs="?", default=DEFAULT_SOURCE)
    parser.add_argument("output", nargs="?", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    source_dir = Path(args.source).resolve()
    output_dir = Path(args.output).resolve()

    if not source_dir.is_dir():
        print(f"Source directory not found: {source_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    clean_output(output_dir)

    modules: List[str] = []
    total_entries = 0
    for csv_path in sorted(source_dir.rglob("*.csv")):
        try:
            module_name, count = process_csv(csv_path, source_dir, output_dir)
            modules.append(module_name)
            total_entries += count
            print(f"  {csv_path.relative_to(source_dir)} -> {module_name} ({count} entries)")
        except Exception as e:
            print(f"Failed to process {csv_path}: {e}", file=sys.stderr)
            return 1

    manifest_path = output_dir / MANIFEST_NAME
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write("-- Auto-generated manifest of translation modules.\n")
        f.write("-- Do not edit manually; run tools/translate/sync-from-poecharm.py.\n")
        f.write("return {\n")
        for mod in sorted(modules):
            f.write(f'  "{mod}",\n')
        f.write("}\n")

    print(f"Generated {len(modules)} translation modules ({total_entries} entries) in {output_dir}")
    print(f"Manifest written to {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
