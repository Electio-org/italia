#!/usr/bin/env python3
"""Audit historical party identities and national election totals."""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import pandas as pd

from party_taxonomy import apply_party_taxonomy_frame, load_party_taxonomy, taxonomy_key
from preprocess import infer_party_meta


IDENTITY_WINDOWS = {
    "Azione / IV": (2022, 2022),
    "Verdi / AVS": (2022, 2022),
    "AVS / Verdi": (2022, 2022),
    "FdI": (2013, 9999),
    "PD": (2008, 9999),
    "M5S": (2013, 9999),
    "Forza Italia": (1994, 9999),
    "PdL": (2008, 2013),
    "PDS / DS": (1992, 2006),
}


def election_year(election_key: str) -> int:
    match = re.search(r"(?:19|20)\d{2}", election_key)
    if not match:
        raise ValueError(f"Election key without year: {election_key}")
    return int(match.group(0))


def load_checks(path: Path) -> Dict[str, Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return {row["election_key"]: row for row in csv.DictReader(handle)}


def source_files(root: Path) -> Iterable[Path]:
    return sorted((root / "data" / "derived" / "results_by_election").glob("*.csv"))


def audit(root: Path) -> Dict[str, object]:
    checks = load_checks(root / "data" / "reference" / "national_election_checks.csv")
    registry = load_party_taxonomy(str(root / "data" / "reference" / "party_taxonomy_overrides.csv"))
    seen_pairs = set()
    elections: List[Dict[str, object]] = []
    errors: List[str] = []
    warnings: List[str] = []

    for path in source_files(root):
        election_key = path.stem
        rows = pd.read_csv(path, dtype=str).fillna("")
        if rows.empty:
            errors.append(f"{election_key}: empty result shard")
            continue
        rows = apply_party_taxonomy_frame(rows, infer_party_meta, registry)
        rows["votes_num"] = pd.to_numeric(rows["votes"], errors="coerce").fillna(0)
        year = election_year(election_key)
        seen_pairs.update(taxonomy_key(election_key, value) for value in rows["party_raw"].unique())

        conflicting = (
            rows.groupby("party_raw")[["party_std", "party_family", "bloc"]]
            .nunique(dropna=False)
            .max(axis=1)
        )
        for raw in conflicting[conflicting > 1].index:
            errors.append(f"{election_key}: inconsistent taxonomy for {raw}")

        identities = rows[["party_raw", "party_std"]].drop_duplicates()
        for _, identity in identities.iterrows():
            standard = str(identity["party_std"])
            if standard not in IDENTITY_WINDOWS:
                continue
            first, last = IDENTITY_WINDOWS[standard]
            if not first <= year <= last:
                errors.append(
                    f"{election_key}: anachronistic identity {standard} for {identity['party_raw']}"
                )

        party_totals = (
            rows.groupby("party_raw", sort=False)["votes_num"].sum().sort_values(ascending=False)
        )
        national_total = float(party_totals.sum())
        winner_raw = str(party_totals.index[0])
        winner_share = float(party_totals.iloc[0] / national_total * 100) if national_total else 0.0
        expected = checks.get(election_key)
        if not expected:
            errors.append(f"{election_key}: missing national election check")
        else:
            if winner_raw != expected["expected_winner_raw"]:
                errors.append(
                    f"{election_key}: winner {winner_raw}, expected {expected['expected_winner_raw']}"
                )
            lower = float(expected["min_winner_share"])
            upper = float(expected["max_winner_share"])
            if not lower <= winner_share <= upper:
                errors.append(
                    f"{election_key}: winner share {winner_share:.3f} outside [{lower}, {upper}]"
                )

        bloc_totals = rows.groupby("bloc")["votes_num"].sum().sort_values(ascending=False)
        bloc_shares = {
            str(label): round(float(votes / national_total * 100), 4)
            for label, votes in bloc_totals.items()
            if national_total
        }
        unmatched_share = bloc_shares.get("altro", 0.0)
        if unmatched_share > 3.5:
            warnings.append(f"{election_key}: {unmatched_share:.2f}% of votes remains in altro")

        top_parties = [
            {
                "party_raw": str(label),
                "votes": int(votes),
                "share": round(float(votes / national_total * 100), 4),
            }
            for label, votes in party_totals.head(12).items()
        ]
        elections.append(
            {
                "election_key": election_key,
                "year": year,
                "result_rows": int(len(rows)),
                "unique_raw_lists": int(rows["party_raw"].nunique()),
                "national_votes": int(national_total),
                "winner_raw": winner_raw,
                "winner_share": round(winner_share, 4),
                "unmatched_bloc_share": unmatched_share,
                "bloc_shares": bloc_shares,
                "top_parties": top_parties,
            }
        )

    for key, row in registry.items():
        if key not in seen_pairs:
            warnings.append(f"Unused party taxonomy override: {row['election_key']} / {row['party_raw']}")
    for election_key in sorted(set(checks) - {row["election_key"] for row in elections}):
        errors.append(f"National check has no result shard: {election_key}")

    return {
        "generated_at": date.today().isoformat(),
        "source": "harmonized public result shards derived from official Eligendo archives",
        "method": "Raw list labels are preserved; exact election-aware overrides precede generic fallback rules.",
        "election_count": len(elections),
        "override_count": len(registry),
        "errors": sorted(set(errors)),
        "warnings": sorted(set(warnings)),
        "ok": not errors,
        "elections": sorted(elections, key=lambda row: row["year"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--write", action="store_true", help="Write data/derived/party_taxonomy_audit.json")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    report = audit(root)
    if args.write:
        output = root / "data" / "derived" / "party_taxonomy_audit.json"
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["election_count", "override_count", "errors", "warnings", "ok"]}, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
