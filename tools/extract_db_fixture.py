#!/usr/bin/env python3
"""Extract a trimmed JB2A database fixture for the SVA unit tests.

Reads ``jb2a_patreon/scripts/jb2a_sequencer.js`` straight out of the JB2A
Patreon module zip (nothing is extracted to disk, no media is touched),
parses the ``patreonDatabase`` object literal and writes a small JSON subset
containing only database *paths* to ``tests/fixtures/jb2a-db.json``.

Usage:
    python tools/extract_db_fixture.py --zip E:/jb2a/module-0.9.3.zip
    python tools/extract_db_fixture.py --zip ... --full full-db.json   # whole DB (never commit it)
    python tools/extract_db_fixture.py --zip ... --stats               # print structure statistics

Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

DB_SCRIPT = "jb2a_patreon/scripts/jb2a_sequencer.js"
PREFIX = "modules"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "jb2a-db.json"

# Dot paths (without the "jb2a." root) copied into the fixture. Every selected
# node keeps the metadata keys (`_template`, `_markers`, `_metadata`) of its ancestors.
SELECTION = [
    # _markers (loop points) on an intermediate node
    "ambient_fog.001.complete.small.blue",
    "ambient_fog.001.complete.small.white",
    "ambient_fog.001.complete.large.blue",
    # _markers with loop + forcedEnd
    "magic_signs.circle.02.abjuration.complete.dark_blue",
    # ranged template + distance variants
    "fire_bolt.orange",
    "fire_bolt.blue",
    "fire_bolt.dark_red",
    "magic_missile",
    "scorching_ray",
    # melee weapon (melee template)
    "greatsword",
    # arrays (random pick), including arrays inside distance variants
    "burrow.out",
    "burrow.ranged",
    "breath_weapons.fire.cone.multicolored",
    # PF2e-specific variants
    "template_cone_PF2e.001.001.blue",
    "template_cone_PF2e.001.001.orangeyellow",
    "volley_of_projectiles_ConePF2e.arrow.001.001.blue",
    "volley_of_projectiles_ConePF2e.arrow.001.001.greenpurple",
]

# Cap on children kept per branch inside a selected subtree (keeps the fixture small).
MAX_CHILDREN = 4


# --------------------------------------------------------------------------- JS literal parser


class JsParser:
    """Tiny recursive-descent parser for the JS object literals used by JB2A."""

    def __init__(self, text: str, prefix: str):
        self.s = text
        self.i = 0
        self.prefix = prefix

    def error(self, msg: str):
        line = self.s.count("\n", 0, self.i) + 1
        raise ValueError(f"{msg} at line {line}")

    def skip(self):
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif s.startswith("//", self.i):
                end = s.find("\n", self.i)
                self.i = len(s) if end < 0 else end + 1
            elif s.startswith("/*", self.i):
                end = s.find("*/", self.i)
                if end < 0:
                    self.error("unterminated comment")
                self.i = end + 2
            else:
                break

    def peek(self) -> str:
        self.skip()
        return self.s[self.i] if self.i < len(self.s) else ""

    def expect(self, ch: str):
        if self.peek() != ch:
            self.error(f"expected {ch!r}")
        self.i += 1

    def value(self):
        c = self.peek()
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "'\"`":
            return self.string()
        m = re.compile(r"-?\d+(\.\d+)?").match(self.s, self.i)
        if m:
            self.i = m.end()
            return float(m.group()) if m.group(1) else int(m.group())
        m = re.compile(r"(true|false|null)\b").match(self.s, self.i)
        if m:
            self.i = m.end()
            return {"true": True, "false": False, "null": None}[m.group()]
        self.error("unexpected token")

    def string(self) -> str:
        quote = self.s[self.i]
        end = self.s.find(quote, self.i + 1)
        if end < 0:
            self.error("unterminated string")
        raw = self.s[self.i + 1 : end]
        self.i = end + 1
        if "\\" in raw:
            self.error("escape sequences are not supported")
        if quote == "`":
            raw = raw.replace("${prefix}", self.prefix)
            if "${" in raw:
                self.error("unsupported template expression")
        return raw

    def key(self) -> str:
        c = self.peek()
        if c in "'\"`":
            return self.string()
        m = re.compile(r"[A-Za-z0-9_$]+").match(self.s, self.i)
        if not m:
            self.error("expected key")
        self.i = m.end()
        return m.group()

    def obj(self) -> dict:
        self.expect("{")
        out = {}
        while self.peek() != "}":
            k = self.key()
            self.expect(":")
            out[k] = self.value()
            if self.peek() == ",":
                self.i += 1
        self.i += 1
        return out

    def arr(self) -> list:
        self.expect("[")
        out = []
        while self.peek() != "]":
            out.append(self.value())
            if self.peek() == ",":
                self.i += 1
        self.i += 1
        return out


ASSIGN = re.compile(r"patreonDatabase\.([A-Za-z0-9_$]+)\s*=\s*")


def parse_database(source: str, prefix: str = PREFIX) -> dict:
    """Evaluate every `patreonDatabase.<key> = {...}` assignment."""
    db = {}
    parser = JsParser(source, prefix)
    for m in ASSIGN.finditer(source):
        parser.i = m.end()
        db[m.group(1)] = parser.value()
    if "_templates" not in db:
        raise ValueError("no _templates found - unexpected jb2a_sequencer.js layout")
    return db


def read_database(zip_path: str, prefix: str = PREFIX) -> dict:
    with zipfile.ZipFile(zip_path) as z:
        source = z.read(DB_SCRIPT).decode("utf-8")
    return parse_database(source, prefix)


# --------------------------------------------------------------------------- fixture selection


def trim(node, limit: int):
    """Keep metadata keys and at most `limit` child nodes per branch (distance variants are never cut)."""
    if not isinstance(node, dict):
        return copy.deepcopy(node)
    keys = [k for k in node if not k.startswith("_")]
    if keys and all(re.fullmatch(r"\d+ft", k) for k in keys):
        limit = len(keys)
    out = {}
    kept = 0
    for k, v in node.items():
        if k.startswith("_"):
            out[k] = copy.deepcopy(v)
        elif kept < limit:
            out[k] = trim(v, limit)
            kept += 1
    return out


def select(db: dict, paths: list[str], limit: int = MAX_CHILDREN) -> dict:
    out = {"_templates": copy.deepcopy(db["_templates"])}
    for path in paths:
        keys = path.split(".")
        src, dst = db, out
        for depth, k in enumerate(keys):
            if not isinstance(src, dict) or k not in src:
                raise KeyError(f"path not found in JB2A database: {path}")
            if depth == len(keys) - 1:
                dst[k] = trim(src[k], limit)
                break
            src = src[k]
            dst = dst.setdefault(k, {})
            for mk, mv in src.items():
                if mk.startswith("_"):
                    dst[mk] = copy.deepcopy(mv)
    return out


# --------------------------------------------------------------------------- stats


def stats(db: dict) -> dict:
    counters = {"meta": Counter(), "templates_used": Counter(), "ft_keys": Counter(), "marker_kinds": Counter()}
    totals = Counter()

    def walk(node, path):
        if isinstance(node, str):
            totals["leaves"] += 1
            return
        if isinstance(node, list):
            totals["arrays"] += 1
            totals["leaves"] += 1
            return
        keys = [k for k in node if not k.startswith("_")]
        ft = [k for k in keys if re.fullmatch(r"\d+ft", k)]
        for k in ft:
            counters["ft_keys"][k] += 1
        if ft and len(ft) != len(keys):
            totals["mixed_distance_nodes"] += 1
        for k, v in node.items():
            if k.startswith("_"):
                counters["meta"][k] += 1
                if k == "_template":
                    counters["templates_used"][v] += 1
                if k == "_markers":
                    counters["marker_kinds"].update(v.keys())
            else:
                walk(v, f"{path}.{k}")

    for k, v in db.items():
        if not k.startswith("_"):
            totals["categories"] += 1
            walk(v, f"jb2a.{k}")
    return {"totals": dict(totals), **{k: dict(v) for k, v in counters.items()}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zip", required=True, help="path to the JB2A Patreon module zip (read only)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="fixture output path")
    ap.add_argument("--prefix", default=PREFIX, help="value substituted for ${prefix} (JB2A jb2aLocation)")
    ap.add_argument("--full", help="also write the whole parsed database here (do NOT commit)")
    ap.add_argument("--stats", action="store_true", help="print structure statistics")
    args = ap.parse_args(argv)

    db = read_database(args.zip, args.prefix)
    if args.stats:
        print(json.dumps(stats(db), indent=2))
    if args.full:
        Path(args.full).write_text(json.dumps(db, indent=1), encoding="utf-8", newline="\n")
    fixture = select(db, SELECTION)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
