#!/usr/bin/env python3
"""Ensure Python and browser fallback taxonomies agree for every observed label."""
from __future__ import annotations

import csv
import json
import subprocess
import tempfile
from pathlib import Path

from preprocess import infer_party_meta


FIELDS = ("display", "family", "bloc", "color")


def observed_labels(root: Path) -> list[str]:
    labels = set()
    for path in sorted((root / "data" / "derived" / "results_by_election").glob("*.csv")):
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                label = str(row.get("party_raw") or "").strip()
                if label:
                    labels.add(label)
    return sorted(labels, key=str.casefold)


def browser_metadata(root: Path, labels: list[str]) -> dict[str, dict[str, str]]:
    module_url = (root / "modules" / "shared.js").resolve().as_uri()
    script = f"""
import fs from 'node:fs';
import {{ inferPartyMeta }} from {json.dumps(module_url)};
const labels = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const out = Object.fromEntries(labels.map(label => [label, inferPartyMeta(label)]));
process.stdout.write(JSON.stringify(out));
"""
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump(labels, handle, ensure_ascii=False)
        labels_path = Path(handle.name)
    try:
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script, str(labels_path)],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        return json.loads(completed.stdout)
    finally:
        labels_path.unlink(missing_ok=True)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    labels = observed_labels(root)
    browser = browser_metadata(root, labels)
    mismatches = []
    for label in labels:
        python_meta = infer_party_meta(label)
        browser_meta = browser.get(label) or {}
        differences = {
            field: {"python": python_meta.get(field), "browser": browser_meta.get(field)}
            for field in FIELDS
            if python_meta.get(field) != browser_meta.get(field)
        }
        if differences:
            mismatches.append({"party_raw": label, "differences": differences})
    if mismatches:
        print(json.dumps(mismatches[:20], ensure_ascii=False, indent=2))
        return 1
    print(f"party taxonomy parity smoke: ok ({len(labels)} observed labels)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
