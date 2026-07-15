"""Canonical election-source discovery shared by Electio build steps."""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List


ELECTION_COLUMNS = [
    "election_key", "election_year", "election_date", "election_label",
    "electoral_system", "status", "is_complete", "comparability_notes", "source_notes",
]


def canonical_summary_paths(derived: Path) -> List[Path]:
    paths = [derived / "municipality_summary.csv"]
    european = derived / "european_municipality_summary.csv.gz"
    if european.exists():
        paths.append(european)
    return paths


def canonical_results_paths(derived: Path) -> List[Path]:
    paths = [derived / "municipality_results_long.csv"]
    european = derived / "european_municipality_results_long.csv.gz"
    if european.exists():
        paths.append(european)
    return paths


def load_combined_elections(derived: Path) -> List[Dict[str, str]]:
    by_key: Dict[str, Dict[str, str]] = {}
    for path in [derived / "elections_master.csv", derived / "european_elections_master.csv"]:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                key = str(row.get("election_key") or "").strip()
                if key:
                    by_key[key] = {column: str(row.get(column) or "") for column in ELECTION_COLUMNS}
    return sorted(by_key.values(), key=lambda row: (row["election_date"], row["election_key"]))


def publish_combined_elections_master(derived: Path) -> List[Dict[str, str]]:
    rows = load_combined_elections(derived)
    path = derived / "elections_master.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=ELECTION_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return rows
