#!/usr/bin/env python3
"""Audit translation coverage by extracting every English string from upstream
Path of Building source and comparing it against the PoeCharm zh-rCN corpus.

Two modes:

    audit          Print coverage summary + MISS detail. Use this to find which
                   English keys are NOT translated and need to be added.

    translate      Single-string T() simulator. Given one English string, replay
                   every fallback path (prefix key match, labelPart split,
                   comma-list, template normalisation, numPart compare, prefix
                   trim) and print what boot.lua's T() would produce.

The audit focuses on the data feeding the gem/skill tooltip:
    skills.desc            gem description (Data/Skills/act_int.lua)
    skills.name            gem display name (Data/Skills/act_int.lua)
    stat_text              stat description text (Data/StatDescriptions/*.lua)
    display_label          build display stat label (Modules/BuildDisplayStats.lua)

Upstream source layout (resolved via --upstream, default below):
    <upstream>/Data/Skills/{act_int,act_dex,act_str,sup_int,sup_dex,sup_str,
                             minion,spectre,glove,other}.lua
    <upstream>/Data/StatDescriptions/*.lua
    <upstream>/Modules/BuildDisplayStats.lua

Corpus layout (resolved via --corpus, default below):
    <corpus>/*.csv  -- 2-column CSV "english,chinese" (UTF-8 BOM)

Usage:
    audit-coverage.py audit [--source X] [--focus S] [--max-miss N] [--upstream P] [--corpus P]
    audit-coverage.py translate "english string" [--corpus P]
"""

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

DEFAULT_UPSTREAM = Path(
    "packages/packer/r2/games/poe1/versions/v2.67.2/root"
)
DEFAULT_CORPUS = Path("/Users/xingyuke/Windows/code/ai/POE/PoeCharm/Data/Translate/zh-rCN")

SKILL_FILES = [
    "act_int", "act_dex", "act_str",
    "sup_int", "sup_dex", "sup_str",
    "minion", "spectre", "glove", "other",
]

STAT_DESC_DIR = "Data/StatDescriptions"
DISPLAY_STATS_FILE = "Modules/BuildDisplayStats.lua"


# ---------------------------------------------------------------------------
# Corpus loading
# ---------------------------------------------------------------------------

def load_corpus(corpus_dir: Path):
    """key (lower) -> list of (file, value, line_no)."""
    idx: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
    files = sorted(corpus_dir.rglob("*.csv"))
    for csv_file in files:
        try:
            fh = open(csv_file, encoding="utf-8-sig", newline="")
        except OSError as e:
            print(f"!! cannot open {csv_file}: {e}", file=sys.stderr)
            continue
        with fh:
            for line_no, row in enumerate(csv.reader(fh), 1):
                if len(row) < 2:
                    continue
                key = row[0].strip()
                if not key:
                    continue
                idx[key.lower()].append((csv_file.name, row[1].strip(), line_no))
    return idx, files


def lookup(idx, text: str):
    """Return (kind, hits). kind in EXACT/SUBSTR/MISS.

    SUBSTR matches a key that contains the query as substring; this catches
    template keys where the runtime text has hardcoded numbers substituted in
    (e.g. query "Every 2 prior Mines Detonated" -> key "Every {0} prior Mines Detonated").
    """
    q = text.lower()
    if q in idx:
        return "EXACT", idx[q]
    subs = []
    for k, hits in idx.items():
        if q in k:
            subs.extend(hits)
    if subs:
        return "SUBSTR", subs
    return "MISS", []


def strip_escapes(text: str) -> str:
    """Mirror boot.lua stripEscapes: drop ^xRRGGBB and ^N colour codes."""
    return re.sub(r"\^x[0-9a-fA-F]{6}", "", re.sub(r"\^\d", "", text))


def resolve_to_template(text: str):
    """Python port of boot.lua resolveToTemplate (item mod normalisation).

    Ranges like (80-120) and bare signed/unsigned numbers become {N}
    placeholders so the line can be looked up in the statDescriptions table.
    Markers are 1-based (@V1@ -> {0}) to match Lua's n=n+1 counter.
    """
    values: list[str] = []

    def rb(m: re.Match) -> str:
        values.append(m.group(0))
        return "@V%d@" % len(values)

    templ = re.sub(r"\([^()]*\)", rb, text)

    def rn(m: re.Match) -> str:
        values.append(m.group(0))
        return "@V%d@" % len(values)

    # Negative lookbehind prevents re-matching the digit inside an inserted @Vn@.
    templ = re.sub(r"(?<!@V)(?<!\d)[+\-]?\d+\.?\d*", rn, templ)

    def rm(m: re.Match) -> str:
        return "{%d}" % (int(m.group(1)) - 1)

    templ = re.sub(r"@V(\d+)@", rm, templ)
    return templ, values


def lookup_template(idx, text: str):
    """T() simulator for item/flavour lines (numbers -> placeholders).

    Returns (kind, hits) where kind is one of EXACT / TEMPLATE / MISS.
    EXACT / TEMPLATE are both "translated" at runtime.

    A second TEMPLATE fallback strips a single leading '+'/'-': GGG's statText
    sometimes omits the sign (e.g. "#% to Fire Resistance") while PoB renders it
    with the sign ("+(20-30)% to Fire Resistance"). This mirrors what PoeCharm's
    TranslateMatch does and what boot.lua's resolveToTemplate *should* do.
    """
    key = strip_escapes(text).lower()
    if key in idx:
        return "EXACT", idx[key]
    # labelPart: "Armour: 960" -> translate "Armour"
    if ":" in key:
        lp = key.split(":", 1)[0]
        if lp in idx:
            return "EXACT", idx[lp]
    # stat-template normalisation (numbers -> {N})
    if re.search(r"[\d%()]", key):
        templ, _ = resolve_to_template(strip_escapes(text))
        tl = templ.lower()
        if tl in idx:
            return "TEMPLATE", idx[tl]
        # fallback: strip leading sign GGG omits in some statText keys
        if re.match(r"^[+\-]", tl):
            tl2 = tl[1:].strip()
            if tl2 in idx:
                return "TEMPLATE", idx[tl2]
    return "MISS", []


# ---------------------------------------------------------------------------
# Lua extraction
# ---------------------------------------------------------------------------

def find_matching_brace(text: str, open_pos: int) -> int:
    """Return position of the '}' that matches the '{' right before open_pos.

    Handles "..." strings (with \\ escapes) and -- line comments so braces
    inside strings/comments are not counted.
    """
    depth = 1
    i = open_pos
    n = len(text)
    while i < n:
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        elif c == '"':
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\" and i + 1 < n:
                    i += 2
                else:
                    i += 1
        elif c == "-" and i + 1 < n and text[i + 1] == "-":
            nl = text.find("\n", i)
            if nl < 0:
                return -1
            i = nl
        i += 1
    return -1


def unescape_lua(s: str) -> str:
    """Minimal Lua string unescape for printing/lookup."""
    return s.encode().decode("unicode_escape")


def extract_string_field(block: str, field: str) -> str | None:
    """Find 'field = "..."' inside a Lua block, return the unescaped value."""
    m = re.search(rf'^\s*{re.escape(field)}\s*=\s*"((?:[^"\\]|\\.)*)"', block, re.MULTILINE)
    if not m:
        return None
    raw = m.group(1)
    # decode Lua string escapes
    out = []
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw):
            nxt = raw[i + 1]
            if nxt == "n":
                out.append("\n")
            elif nxt == "t":
                out.append("\t")
            elif nxt == "r":
                out.append("\r")
            elif nxt == '"':
                out.append('"')
            elif nxt == "\\":
                out.append("\\")
            else:
                out.append(nxt)
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def extract_skills(root: Path):
    """Yield (skill_id, field, text, line_no, source_file) from Data/Skills/*.lua.

    Fields: name, description, baseTypeName. skill_id is the table key
    (e.g. "IcicleMine").
    """
    for fname in SKILL_FILES:
        path = root / "Data" / "Skills" / f"{fname}.lua"
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        # find every skills["..."] = { ... }
        for m in re.finditer(r'(?:^|\n)\s*skills\["([^"]+)"\]\s*=\s*\{', text):
            skill_id = m.group(1)
            open_pos = m.end()
            close = find_matching_brace(text, open_pos)
            if close < 0:
                continue
            block = text[open_pos:close]
            block_line_offset = text.count("\n", 0, open_pos)
            for field in ("name", "description", "baseTypeName"):
                val = extract_string_field(block, field)
                if val:
                    yield (skill_id, field, val, block_line_offset, fname + ".lua")


def find_skill_block(root: Path, skill_id: str):
    """Return (block_text, source_file, line_offset) for a given skill_id, or None."""
    for fname in SKILL_FILES:
        path = root / "Data" / "Skills" / f"{fname}.lua"
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(rf'(?:^|\n)\s*skills\["{re.escape(skill_id)}"\]\s*=\s*\{{', text):
            open_pos = m.end()
            close = find_matching_brace(text, open_pos)
            if close < 0:
                continue
            return text[open_pos:close], fname + ".lua", text.count("\n", 0, open_pos)
    return None


def extract_stat_keys(block: str):
    """Extract all stat keys from a skill block (constantStats/stats/qualityStats)."""
    keys = []
    # patterns: "stat_key_name" or "constantStats"/"qualityStats" entries that
    # contain "key_name"
    for m in re.finditer(r'"([a-z][a-z0-9_]*)"', block):
        key = m.group(1)
        # filter: only known stat-like keys (snake_case, all lowercase)
        if "_" in key and not any(c.isupper() for c in key):
            keys.append(key)
    return sorted(set(keys))


def build_stat_text_index(root: Path):
    """Reverse-index stat_descriptions/*.lua: stat_key -> [text, ...].

    Each StatDescriptions file is structured as [stat_id] = { [1] = { ..., text = "..." } }
    where the key into the outer table is the stat id. We need the stat id from the
    outer table and then all `text = "..."` inside its value.
    """
    idx = defaultdict(list)
    sd_dir = root / STAT_DESC_DIR
    if not sd_dir.is_dir():
        return idx
    for path in sorted(sd_dir.glob("*.lua")):
        text = path.read_text(encoding="utf-8", errors="replace")
        # find outer table keys: [1]=, [2]=, ..., ["some_key"]=
        # we look for entries whose value contains a "stats={ ... }" subtable listing stat ids
        # and follow up to collect their text entries.
        for outer in re.finditer(r'\["([a-zA-Z0-9_]+)"\]\s*=\s*\{', text):
            stat_id = outer.group(1)
            if stat_id in ("stats", "limit"):  # subfield, skip
                continue
            open_pos = outer.end()
            close = find_matching_brace(text, open_pos)
            if close < 0:
                continue
            block = text[open_pos:close]
            for tm in re.finditer(r'text\s*=\s*"((?:[^"\\]|\\.)*)"', block):
                idx[stat_id].append(unescape_simple(tm.group(1)))
        # numeric outer keys: [1]={ stats={"x","y"}, [1]={ text="..." } }
        for outer in re.finditer(r'\[(\d+)\]\s*=\s*\{', text):
            open_pos = outer.end()
            close = find_matching_brace(text, open_pos)
            if close < 0:
                continue
            block = text[open_pos:close]
            # find inner stats={...} declaration
            stats_m = re.search(r'stats\s*=\s*\{([^}]*)\}', block)
            if not stats_m:
                continue
            stat_ids = re.findall(r'"([a-zA-Z0-9_]+)"', stats_m.group(1))
            for tm in re.finditer(r'text\s*=\s*"((?:[^"\\]|\\.)*)"', block):
                val = unescape_simple(tm.group(1))
                for sid in stat_ids:
                    idx[sid].append(val)
    return idx


def extract_stat_texts(root: Path):
    """Yield (text, line_no, file) for every 'text = "..."' in StatDescriptions."""
    sd_dir = root / STAT_DESC_DIR
    if not sd_dir.is_dir():
        return
    for path in sorted(sd_dir.glob("*.lua")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'text\s*=\s*"((?:[^"\\]|\\.)*)"', text):
            raw = m.group(1)
            val = unescape_simple(raw)
            line_no = text.count("\n", 0, m.start()) + 1
            yield (val, line_no, path.name)


def unescape_simple(raw: str) -> str:
    out = []
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw):
            nxt = raw[i + 1]
            if nxt == "n":
                out.append("\n")
            elif nxt == "t":
                out.append("\t")
            elif nxt == "r":
                out.append("\r")
            elif nxt == '"':
                out.append('"')
            elif nxt == "\\":
                out.append("\\")
            else:
                out.append(nxt)
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def extract_display_labels(root: Path):
    """Yield (label, line_no) from Modules/BuildDisplayStats.lua."""
    path = root / DISPLAY_STATS_FILE
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'label\s*=\s*"([^"]*)"', text):
        line_no = text.count("\n", 0, m.start()) + 1
        yield (m.group(1), line_no)


# ---------------------------------------------------------------------------
# Item extraction
# ---------------------------------------------------------------------------

BASES_DIR = "Data/Bases"
UNIQUES_DIR = "Data/Uniques"
FLAVOUR_FILE = "Data/FlavourText.lua"


def extract_item_bases(root: Path):
    """Yield (source, text, line_no, file) from Data/Bases/*.lua.

    Sources: base.name (itemBases key), base.type (deduped type field).
    """
    bases_dir = root / BASES_DIR
    if not bases_dir.is_dir():
        return
    for path in sorted(bases_dir.glob("*.lua")):
        text = path.read_text(encoding="utf-8", errors="replace")
        seen_types = set()
        for m in re.finditer(r'itemBases\["([^"]+)"\]\s*=\s*\{', text):
            base_name = m.group(1)
            line_no = text.count("\n", 0, m.start()) + 1
            yield ("base.name", base_name, line_no, path.name)
            open_pos = m.end()
            close = find_matching_brace(text, open_pos)
            if close < 0:
                continue
            block = text[open_pos:close]
            type_m = re.search(r'\btype\s*=\s*"([^"]+)"', block)
            if type_m and type_m.group(1) not in seen_types:
                seen_types.add(type_m.group(1))
                tline = text.count("\n", 0, open_pos) + block[: type_m.start()].count("\n") + 1
                yield ("base.type", type_m.group(1), tline, path.name)


def extract_item_uniques(root: Path):
    """Yield (source, text, line_no, file) from Data/Uniques/**/*.lua.

    Each [[ ... ]] block: line 1 = unique name, line 2 = base type.
    Variant/metadata blocks (e.g. Generated.lua precursorsEmblem) are skipped.
    """
    META_MARKERS = (
        "Variant:", "Implicits:", "Requires Level", "Item Class:", "Limited to:",
        "Selected Variant", "scenarios exist", "League:", "Source:", "LevelReq:",
        "Has Alt", "Has Alt Variant",
    )
    uniques_dir = root / UNIQUES_DIR
    if not uniques_dir.is_dir():
        return
    for path in sorted(uniques_dir.rglob("*.lua")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"\[\[(.+?)\]\]", text, re.DOTALL):
            block = m.group(1)
            lines = [ln.strip() for ln in block.split("\n") if ln.strip() != ""]
            if not lines:
                continue
            first = lines[0]
            if any(mk in first for mk in META_MARKERS):
                continue  # variant/metadata block, not a unique name
            # strip PoB {variant:N} prefixes that are removed at render time
            first_clean = re.sub(r"^\{variant:[0-9,]*\}", "", first).strip()
            start_line = text.count("\n", 0, m.start()) + 1
            yield ("unique.name", first_clean, start_line, path.name)
            if len(lines) >= 2 and lines[1] != "--":
                base = re.sub(r"^\{variant:[0-9,]*\}", "", lines[1]).strip()
                if base:
                    yield ("unique.base", base, start_line + 1, path.name)


# Lines that are metadata, not translatable mod text, inside a unique [[ ]] block.
UNIQUE_META_PREFIXES = (
    "League:", "Source:", "Requires Level", "Implicits:", "Item Class:",
    "Limited to:", "Variant:", "Selected Variant", "Selected Alt Variant",
    "Has Alt", "Has Alt Variant", "LevelReq:", "Lvl", "Drop Level",
    "DropLevel:", "Item Level:",
    "--",
)

# base-type words used to reject variant base-name lines (e.g. "{variant:1}Topaz Ring")
UNIQUE_BASE_WORDS = re.compile(
    r"\b(Ring|Amulet|Belt|Helmet|Gloves|Boots|Body|Shield|Sword|Axe|Mace|Staff|"
    r"Bow|Claw|Dagger|Wand|Quiver|Flask|Jewel|Graft|Tincture|Map|Charm)\b",
    re.IGNORECASE,
)
UNIQUE_MOD_HINT = re.compile(
    r"[+\-]|%|\d|increased|reduced|added|adds|to |of |per |chance|penetrate|"
    r"regenerate|leech|gain|grant|deal|extra|minimum|maximum|attack|cast|spell|"
    r"life|mana|energy|armour|evasion|block|dodge|critical|crit|resistance|"
    r"attribute|strength|dexterity|intelligence|damage|fire|cold|lightning|"
    r"chaos|physical|melee|projectile|area|aoe|recover|ward|reflect|from |"
    r"convert|ignore|avoid|additional|more |less |warcry|mine|trap|totem",
    re.IGNORECASE,
)


def _is_unique_mod_line(clean: str) -> bool:
    """True if the line is an actual stat line, not a variant base name.

    Variant blocks (e.g. precursorsEmblem) embed base names like
    "{variant:1}Topaz Ring" using the same {variant:N} prefix as real mods.
    Reject those: a base word with no stat hint is a base-name line.
    """
    if UNIQUE_BASE_WORDS.search(clean) and not re.search(
        r"[+\-]%?|\d|%|increased|reduced|added|adds|to |of |per |chance|leech|"
        r"gain|regenerate|penetrate|damage|resistance|attribute|life|mana|energy|"
        r"armour|evasion|block|dodge|critical|crit|attack|cast|spell|maximum|"
        r"minimum|extra|reflect|recover|ward|convert|ignore|avoid|warcry|mine|trap|totem",
        clean, re.IGNORECASE,
    ):
        return False
    return bool(UNIQUE_MOD_HINT.search(clean))


def extract_unique_mods(root: Path):
    """Yield (source, text, line_no, file) for unique item mod lines.

    Each [[ ... ]] block: line 0 = unique name, line 1 = base type, the rest
    are mod lines (implicit + explicit). Metadata lines (League:/Source:/
    Requires Level/Implicits:/Variant:/-- comments ...) and variant base names
    are skipped; the {tags:...}/{variant:...} prefixes are stripped. The bare
    display text is what DrawString renders and T() translates. These lines use
    resolveToTemplate normalisation (numbers -> placeholders) so the audit
    mirrors runtime translation.
    """
    uniques_dir = root / UNIQUES_DIR
    if not uniques_dir.is_dir():
        return
    for path in sorted(uniques_dir.rglob("*.lua")):
        # Programmatically generated variant file (precursorsEmblem, veiled, etc.):
        # its [[ ]] blocks mix variant base names, variant metadata and comments
        # with the real mod lines, which are duplicates of the regular files.
        if path.name == "Generated.lua":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"\[\[(.+?)\]\]", text, re.DOTALL):
            block = m.group(1)
            start_line = text.count("\n", 0, m.start()) + 1
            raw_lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
            if len(raw_lines) < 3:
                continue  # need name, base, and at least one mod
            for offset, ln in enumerate(raw_lines[2:], start=2):
                # drop single-dash comments ("- Mod removed") but keep "-20%" mods
                if ln.startswith("--") or re.match(r"^-[A-Za-z]", ln):
                    continue
                if any(ln.startswith(p) for p in UNIQUE_META_PREFIXES):
                    continue
                clean = ln
                # strip any leading { ... } prefixes (tags / variant)
                while True:
                    new = re.sub(r"^\{[^}]*\}", "", clean).strip()
                    if new == clean:
                        break
                    clean = new
                if not clean or not _is_unique_mod_line(clean):
                    continue
                line_no = start_line + offset
                yield ("unique.mods", clean, line_no, path.name)


def extract_flavour_text(root: Path):
    """Yield (source, text, line_no, file) from Data/FlavourText.lua text arrays."""
    path = root / FLAVOUR_FILE
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r"text\s*=\s*\{([^}]*)\}", text):
        block = m.group(1)
        block_start = text.count("\n", 0, m.start())
        for sm in re.finditer(r'"((?:[^"\\]|\\.)*)"', block):
            val = unescape_simple(sm.group(1))
            line_no = block_start + block[: sm.start()].count("\n") + 1
            yield ("flavour.text", val, line_no, path.name)


MOD_AFFIX_DIR = "Data"


def extract_mod_affixes(root: Path):
    """Yield (source, text, line_no, file) of mod `affix = "..."` names.

    Affix names (e.g. "of the Brute") are the item mod's prefix/suffix label,
    distinct from the stat text. Only top-level Data/*.lua are scanned (Bases/
    Uniques subdirs use different formats). Duplicates across files are skipped.
    """
    data_dir = root / MOD_AFFIX_DIR
    if not data_dir.is_dir():
        return
    seen = set()
    for path in sorted(data_dir.glob("*.lua")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'\baffix\s*=\s*"([^"]*)"', text):
            val = m.group(1)
            if val in seen:
                continue
            seen.add(val)
            line_no = text.count("\n", 0, m.start()) + 1
            yield ("mod.affix", val, line_no, path.name)


# ---------------------------------------------------------------------------
# Audit mode
# ---------------------------------------------------------------------------

SOURCES = {
    "base.name": lambda root: (
        ("base.name", t, f, ln, t) for (s, t, ln, f) in extract_item_bases(root) if s == "base.name"
    ),
    "base.type": lambda root: (
        ("base.type", t, f, ln, t) for (s, t, ln, f) in extract_item_bases(root) if s == "base.type"
    ),
    "unique.name": lambda root: (
        ("unique.name", t, f, ln, t) for (s, t, ln, f) in extract_item_uniques(root) if s == "unique.name"
    ),
    "unique.base": lambda root: (
        ("unique.base", t, f, ln, t) for (s, t, ln, f) in extract_item_uniques(root) if s == "unique.base"
    ),
    "unique.mods": lambda root: (
        ("unique.mods", t, f, ln, t) for (s, t, ln, f) in extract_unique_mods(root)
    ),
    "flavour.text": lambda root: (
        ("flavour.text", t, f, ln, t) for (s, t, ln, f) in extract_flavour_text(root)
    ),
    "mod.affix": lambda root: (
        ("mod.affix", t, f, ln, t) for (s, t, ln, f) in extract_mod_affixes(root)
    ),
    "skills.desc": lambda root: (
        ("skills.desc", sid, fname, ln, t)
        for (sid, f, t, ln, fname) in extract_skills(root)
        if f == "description"
    ),
    "skills.name": lambda root: (
        ("skills.name", sid, fname, ln, t)
        for (sid, f, t, ln, fname) in extract_skills(root)
        if f == "name"
    ),
    "stat_text": lambda root: (
        ("stat_text", f"{f}:{n}", f, n, t) for (t, n, f) in extract_stat_texts(root)
    ),
    "display_label": lambda root: (
        ("display_label", t, "BuildDisplayStats.lua", n, t)
        for (t, n) in extract_display_labels(root)
    ),
}


def run_audit(args):
    root = Path(args.upstream).resolve()
    corpus = Path(args.corpus).resolve()
    if not corpus.is_dir():
        print(f"Corpus directory not found: {corpus}", file=sys.stderr)
        return 1

    print(f"Upstream: {root}")
    print(f"Corpus:   {corpus}\n")

    idx, csv_files = load_corpus(corpus)
    print(f"Loaded {len(idx)} unique keys from {len(csv_files)} CSV files.\n")

    sources = args.source.split(",") if args.source else list(SOURCES.keys())

    # gem-mode takes precedence: extract everything related to one skill.
    if args.gem:
        return run_gem_report(args, idx, sources)

    focus_re = None
    if args.focus:
        focus_re = re.compile(args.focus, re.IGNORECASE)

    summary = []
    for src in sources:
        if src not in SOURCES:
            print(f"!! unknown source: {src}", file=sys.stderr)
            continue
        entries = list(SOURCES[src](root))
        if not entries:
            print(f"[{src}] no entries extracted\n")
            continue

        counts = Counter()
        substr_list = []
        miss_list = []
        lookup_fn = lookup_template if src == "unique.mods" else lookup
        for _kind, ident, file, line, text in entries:
            kind_label, hits = lookup_fn(idx, text)
            counts[kind_label] += 1
            if kind_label == "SUBSTR":
                substr_list.append((ident, file, line, text, hits))
            elif kind_label == "MISS":
                miss_list.append((ident, file, line, text))

        summary.append((src, len(entries), counts))

        # per-source header
        hit = counts["EXACT"] + counts["SUBSTR"] + counts["TEMPLATE"]
        total = hit + counts["MISS"]
        print(f"=== {src} ({total} entries) ===")
        if src == "unique.mods":
            print(f"  EXACT    = {counts['EXACT']:>5}  ({_pct(counts['EXACT'], counts)})")
            print(f"  TEMPLATE = {counts['TEMPLATE']:>5}  ({_pct(counts['TEMPLATE'], counts)})")
            print(f"  MISS     = {counts['MISS']:>5}  ({_pct(counts['MISS'], counts)})")
        else:
            print(f"  EXACT  = {counts['EXACT']:>5}  ({_pct(counts['EXACT'], counts)})")
            print(f"  SUBSTR = {counts['SUBSTR']:>5}  ({_pct(counts['SUBSTR'], counts)})")
            print(f"  MISS   = {counts['MISS']:>5}  ({_pct(counts['MISS'], counts)})")
        print()

        # apply focus filter
        def matches(item):
            if focus_re is None:
                return True
            # item = (ident, file, line, text[, hits])
            ident, file, line, text = item[:4]
            return bool(focus_re.search(text) or focus_re.search(ident))

        substr_shown = [it for it in substr_list if matches(it)]
        miss_shown = [it for it in miss_list if matches(it)]

        if substr_shown:
            print(f"  -- SUBSTR (sample up to {args.max_substr}) --")
            for ident, file, line, text, hits in substr_shown[: args.max_substr]:
                snippet = text if len(text) <= 70 else text[:67] + "..."
                fname, val, ln = hits[0]
                val_show = val if len(val) <= 50 else val[:47] + "..."
                print(f"    {file}:{line} {ident!r}")
                print(f"      src : {snippet!r}")
                print(f"      hit : {fname}:{ln} -> {val_show!r}")
            if len(substr_shown) > args.max_substr:
                print(f"    ... and {len(substr_shown) - args.max_substr} more SUBSTR hits")
            print()

        if miss_shown:
            print(f"  -- MISS (sample up to {args.max_miss}) --")
            for ident, file, line, text in miss_shown[: args.max_miss]:
                snippet = text if len(text) <= 90 else text[:87] + "..."
                print(f"    {file}:{line} {ident!r}")
                print(f"      src : {snippet!r}")
            if len(miss_shown) > args.max_miss:
                print(f"    ... and {len(miss_shown) - args.max_miss} more MISS entries")
            print()
        elif focus_re is not None and not substr_shown:
            print(f"  (no entries matched focus {args.focus!r})\n")

    # final summary table
    print("=== Summary ===")
    has_tpl = any(c.get("TEMPLATE") for _, _, c in summary)
    if has_tpl:
        print(f"{'source':<18} {'total':>8} {'EXACT':>10} {'TMPL':>10} {'MISS':>10}")
        for src, total, counts in summary:
            print(
                f"{src:<18} {total:>8} {counts['EXACT']:>10} {counts['TEMPLATE']:>10} {counts['MISS']:>10}"
            )
    else:
        print(f"{'source':<18} {'total':>8} {'EXACT':>10} {'SUBSTR':>10} {'MISS':>10}")
        for src, total, counts in summary:
            print(
                f"{src:<18} {total:>8} {counts['EXACT']:>10} {counts['SUBSTR']:>10} {counts['MISS']:>10}"
            )
    return 0


def _pct(n, counts):
    total = counts["EXACT"] + counts["SUBSTR"] + counts["MISS"]
    if total == 0:
        return "0%"
    return f"{n / total * 100:.1f}%"


def run_gem_report(args, corpus_idx, sources):
    """Focused report for a single skill."""
    root = Path(args.upstream).resolve()

    found = find_skill_block(root, args.gem)
    if not found:
        print(f"!! skill {args.gem!r} not found in Data/Skills/*.lua", file=sys.stderr)
        return 1
    block, src_file, line_off = found
    print(f"=== Gem report: {args.gem} ({src_file}) ===\n")

    # name / baseTypeName / description
    print("[Strings]")
    for field in ("name", "baseTypeName", "description"):
        val = extract_string_field(block, field)
        if val is None:
            continue
        kind, hits = lookup(corpus_idx, val)
        print(f"  {field}:")
        print(f"    src  : {val!r}")
        if hits:
            fname, v, ln = hits[0]
            print(f"    [{kind:<6}] {fname}:{ln} -> {v!r}")
        else:
            print(f"    [{kind:<6}] (no translation)")
        print()

    # stat keys -> texts -> corpus
    stat_keys = extract_stat_keys(block)
    if not stat_keys:
        print("(no stat keys found in this skill block)\n")
    else:
        print(f"[Stat keys referenced by this skill: {len(stat_keys)}]")
        for k in stat_keys[:8]:
            print(f"  - {k}")
        if len(stat_keys) > 8:
            print(f"  ... and {len(stat_keys) - 8} more")
        print()

        print("[Building reverse stat_text index...]")
        sd_idx = build_stat_text_index(root)
        print(f"  {len(sd_idx)} stat keys indexed from StatDescriptions/*.lua\n")

        # for each stat key this skill uses, list unique text values
        seen_texts = set()
        results = []
        for sk in stat_keys:
            for txt in sd_idx.get(sk, []):
                if txt in seen_texts:
                    continue
                seen_texts.add(txt)
                kind, hits = lookup(corpus_idx, txt)
                results.append((sk, txt, kind, hits))

        counts = Counter(r[2] for r in results)
        total = len(results)
        print(f"[Stat text coverage for this skill: {total} unique text entries]")
        print(f"  EXACT  = {counts['EXACT']:>4}  ({_pct(counts['EXACT'], counts)})")
        print(f"  SUBSTR = {counts['SUBSTR']:>4}  ({_pct(counts['SUBSTR'], counts)})")
        print(f"  MISS   = {counts['MISS']:>4}  ({_pct(counts['MISS'], counts)})")
        print()

        # list all
        print(f"-- detail (sorted by kind: EXACT, SUBSTR, MISS) --")
        for kind in ("EXACT", "SUBSTR", "MISS"):
            for sk, txt, k, hits in results:
                if k != kind:
                    continue
                snippet = txt if len(txt) <= 90 else txt[:87] + "..."
                print(f"  [{k:<6}] stat={sk}")
                print(f"      text: {snippet!r}")
                if hits:
                    fname, v, ln = hits[0]
                    print(f"      hit : {fname}:{ln} -> {v!r}")
                else:
                    print(f"      hit : (none)")
                print()
    return 0


# ---------------------------------------------------------------------------
# translate mode (T() simulator)
# ---------------------------------------------------------------------------

def run_translate(args):
    corpus = Path(args.corpus).resolve()
    if not corpus.is_dir():
        print(f"Corpus directory not found: {corpus}", file=sys.stderr)
        return 1
    idx, _ = load_corpus(corpus)
    text = args.text

    print(f"input:  {text!r}\n")
    kind, hits = lookup_template(idx, text)
    if kind in ("EXACT", "TEMPLATE") and hits:
        fname, val, ln = hits[0]
        print(f"  [{kind}] {val!r}  ({fname}:{ln})")
        return 0
    templ, values = resolve_to_template(strip_escapes(text))
    print(f"  MISS. normalised template: {templ!r}")
    print(f"  values: {values}")
    print(f"  normalize matches key? {templ.lower() in idx}")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--upstream", default=str(DEFAULT_UPSTREAM))
    p.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    sub = p.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("audit", help="Coverage audit across upstream source vs corpus")
    pa.add_argument("--source", help="comma-separated subset of: skills.desc, skills.name, stat_text, display_label")
    pa.add_argument("--focus", help="only show non-exact entries whose text or any SUBSTR key contains this substring")
    pa.add_argument("--max-miss", type=int, default=20, help="max MISS entries to print per source")
    pa.add_argument("--max-substr", type=int, default=10, help="max SUBSTR entries to print per source")
    pa.add_argument("--gem", help="focused report for a single skill id (e.g. IcicleMine)")

    pt = sub.add_parser("translate", help="Simulate T() against a single English string")
    pt.add_argument("text", help="English text to translate")

    args = p.parse_args()
    if args.cmd == "audit":
        return run_audit(args)
    if args.cmd == "translate":
        return run_translate(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())