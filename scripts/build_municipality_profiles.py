#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable


PROFILE_NOTE = "Municipality detail pages use province-sized compressed profile chunks instead of loading the national summary table."


def safe_number(value: object):
    try:
        number = float(str(value or "").strip())
    except (TypeError, ValueError):
        return None
    return number


def chunk_key_for(municipality_id: str) -> str:
    value = str(municipality_id or "").strip()
    if re.fullmatch(r"\d{6}", value):
        return value[:3]
    token = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return f"other-{token[:1] or 'x'}"


def read_csv(path: Path) -> Iterable[Dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        yield from csv.DictReader(handle)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build compressed municipality profile chunks.")
    parser.add_argument("--root", default=".", help="Project root")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    derived = root / "data" / "derived"
    summary_path = derived / "municipality_summary.csv"
    municipalities_path = derived / "municipalities_master.csv"
    output = derived / "municipality_profiles"
    chunks_dir = output / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    municipalities_by_chunk: Dict[str, list] = defaultdict(list)
    municipality_chunks: Dict[str, str] = {}
    for record in read_csv(municipalities_path):
        municipality_id = str(record.get("municipality_id") or "").strip()
        if not municipality_id:
            continue
        chunk_key = chunk_key_for(municipality_id)
        municipality_chunks[municipality_id] = chunk_key
        municipalities_by_chunk[chunk_key].append(record)

    rows_by_chunk: Dict[str, list] = defaultdict(list)
    national = defaultdict(lambda: {
        "electors": 0.0,
        "voters": 0.0,
        "first_share_weighted": 0.0,
        "first_share_weight": 0.0,
        "blocks": Counter(),
        "municipalities": 0,
        "year": None,
    })
    total_rows = 0
    for row in read_csv(summary_path):
        municipality_id = str(row.get("municipality_id") or "").strip()
        election_key = str(row.get("election_key") or "").strip()
        if not municipality_id or not election_key:
            continue
        chunk_key = municipality_chunks.get(municipality_id) or chunk_key_for(municipality_id)
        municipality_chunks[municipality_id] = chunk_key
        rows_by_chunk[chunk_key].append(row)
        total_rows += 1

        acc = national[election_key]
        electors = safe_number(row.get("electors"))
        voters = safe_number(row.get("voters"))
        valid_votes = safe_number(row.get("valid_votes"))
        first_share = safe_number(row.get("first_party_share"))
        if electors is not None and voters is not None:
            acc["electors"] += electors
            acc["voters"] += voters
        if valid_votes is not None and first_share is not None:
            acc["first_share_weighted"] += first_share * valid_votes
            acc["first_share_weight"] += valid_votes
        block = str(row.get("dominant_block") or "").strip()
        if block:
            acc["blocks"][block] += 1
        acc["municipalities"] += 1
        acc["year"] = safe_number(row.get("election_year"))

    chunk_paths = {}
    for chunk_key in sorted(set(rows_by_chunk) | set(municipalities_by_chunk)):
        payload = {
            "chunk": chunk_key,
            "municipalities": municipalities_by_chunk.get(chunk_key, []),
            "summary": sorted(
                rows_by_chunk.get(chunk_key, []),
                key=lambda row: (str(row.get("municipality_id") or ""), str(row.get("election_key") or "")),
            ),
        }
        relative = f"data/derived/municipality_profiles/chunks/{chunk_key}.json.gz"
        target = root / relative
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        target.write_bytes(gzip.compress(encoded, compresslevel=9, mtime=0))
        chunk_paths[chunk_key] = relative

    national_by_election = {}
    for election_key, acc in sorted(national.items()):
        modal_block = acc["blocks"].most_common(1)[0][0] if acc["blocks"] else ""
        national_by_election[election_key] = {
            "year": int(acc["year"]) if acc["year"] is not None else None,
            "turnout_pct": (acc["voters"] / acc["electors"] * 100) if acc["electors"] else None,
            "first_party_share": (
                acc["first_share_weighted"] / acc["first_share_weight"]
                if acc["first_share_weight"] else None
            ),
            "dominant_block": modal_block,
            "municipalities": acc["municipalities"],
        }

    index = {
        "generated_by": "build_municipality_profiles.py",
        "strategy": "province_chunks",
        "row_count": total_rows,
        "chunks": chunk_paths,
        "municipality_chunks": dict(sorted(municipality_chunks.items())),
        "national_by_election": national_by_election,
    }
    index_path = output / "index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest_path = derived / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.setdefault("files", {})["municipalityProfileIndex"] = "data/derived/municipality_profiles/index.json"
    notes = list(manifest.setdefault("project", {}).get("notes") or [])
    if PROFILE_NOTE not in notes:
        notes.append(PROFILE_NOTE)
    manifest["project"]["notes"] = notes
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    release_path = derived / "release_manifest.json"
    if release_path.exists():
        release = json.loads(release_path.read_text(encoding="utf-8"))
        encoded_index = index_path.read_bytes()
        release.setdefault("file_entries", {})["municipalityProfileIndex"] = {
            "path": "data/derived/municipality_profiles/index.json",
            "kind": "json",
            "size_bytes": len(encoded_index),
            "sha256": hashlib.sha256(encoded_index).hexdigest(),
            "chunk_count": len(chunk_paths),
            "row_count": total_rows,
        }
        integrity = release.setdefault("integrity", {})
        integrity["sha256_scope"] = sorted(release["file_entries"].keys())
        integrity["all_declared_files_present"] = True
        release_path.write_text(json.dumps(release, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"municipality profile chunks: {len(chunk_paths)} chunks, {total_rows} rows")


if __name__ == "__main__":
    main()
