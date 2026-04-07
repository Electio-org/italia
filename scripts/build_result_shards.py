#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Dict, List

import pandas as pd


EXTRA_NOTE = "Party results can be delivered both as a monolithic CSV and as per-election shards for faster interactive loading."
ARCHIVE_GAP_NOTE = "The bundle can also declare a gap report that compares published coverage against the official Eligendo open-data archives."
CANONICAL_REBUILD_NOTE = "Municipality coverage is rebuilt from official Eligendo open-data zip archives across all Camera years plus Assemblea Costituente 1946."
CURRENT_VERSION = "0.15.0"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def summarize_file(path: Path, bundle_root: Path) -> Dict[str, object]:
    info = {
        "path": str(path.relative_to(bundle_root)).replace("\\", "/") if path.exists() else str(path).replace("\\", "/"),
        "kind": path.suffix.lower().lstrip(".") or "file",
        "size_bytes": path.stat().st_size if path.exists() else 0,
        "sha256": sha256_file(path) if path.exists() else "",
    }
    if not path.exists():
        return info
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        info["row_count"] = len(rows)
        info["columns"] = list(rows[0].keys()) if rows else []
    elif path.suffix.lower() in {".json", ".geojson"}:
        obj = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(obj, dict):
            if isinstance(obj.get("features"), list):
                info["feature_count"] = len(obj.get("features") or [])
            elif isinstance(obj.get("datasets"), list):
                info["dataset_count"] = len(obj.get("datasets") or [])
            elif isinstance(obj.get("products"), list):
                info["product_count"] = len(obj.get("products") or [])
            elif isinstance(obj.get("entries"), list):
                info["entry_count"] = len(obj.get("entries") or [])
    return info


def slugify(value: str) -> str:
    return str(value).strip().lower().replace(" ", "_")


def ensure_update_log_entry(entries: List[Dict[str, object]]) -> List[Dict[str, object]]:
    if any(str(entry.get("version")) == CURRENT_VERSION for entry in entries):
        return entries
    return [{
        "version": CURRENT_VERSION,
        "date": "2026-04-07",
        "title": "Official open-data zip rebuild with Assemblea Costituente 1946 and refreshed shard metadata",
        "changes": [
            "Rebuilt 1946-2022 municipality summary and party results from the official Eligendo open-data zip archives for Assemblea Costituente and Camera.",
            "Shifted the primary source from HTML archive navigation to the national open-data bundles, keeping HTML only as QA and fallback.",
            "Added by-election shards for municipality_results_long.csv.",
            "Declared deferred result loading in manifest.json.",
            "Aligned dataset registry, provenance, and release metadata to the shard-based delivery layout.",
            "Added an official-source-vs-bundle gap report to make residual coverage and geometry-join gaps explicit in the public bundle.",
            "Release manifest paths are now web-relative, so declared downloads stay usable inside the static site."
        ]
    }, *entries]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build municipality_results_long shards and refresh bundle metadata.")
    parser.add_argument("--root", default=".", help="Project root of lombardia_camera_app_v35")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    derived = root / "data" / "derived"
    manifest_path = derived / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"Manifest non trovato: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    project = manifest.setdefault("project", {})
    project["version"] = CURRENT_VERSION
    notes = list(project.get("notes") or [])
    if EXTRA_NOTE not in notes:
        notes.append(EXTRA_NOTE)
    if ARCHIVE_GAP_NOTE not in notes:
        notes.append(ARCHIVE_GAP_NOTE)
    if CANONICAL_REBUILD_NOTE not in notes:
        notes.append(CANONICAL_REBUILD_NOTE)
    project["notes"] = notes

    files = manifest.setdefault("files", {})
    files["municipalityResultsLongByElectionIndex"] = "data/derived/municipality_results_long_by_election.json"
    manifest["loading"] = {
        "municipalityResultsLong": {
            "strategy": "deferred_by_election",
            "index": "data/derived/municipality_results_long_by_election.json"
        }
    }

    results_path = derived / "municipality_results_long.csv"
    results = pd.read_csv(results_path, dtype=str).fillna("")
    shard_dir = derived / "results_by_election"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for old in shard_dir.glob("*.csv"):
        old.unlink()

    shards: Dict[str, str] = {}
    row_counts: Dict[str, int] = {}
    if not results.empty and "election_key" in results.columns:
        for election_key, chunk in sorted(results.groupby("election_key"), key=lambda item: str(item[0])):
            filename = f"{slugify(str(election_key))}.csv"
            path = shard_dir / filename
            chunk.to_csv(path, index=False)
            shards[str(election_key)] = str(path.relative_to(root)).replace("\\", "/")
            row_counts[str(election_key)] = int(len(chunk))

    shard_index = {
        "generated_by": "build_result_shards.py",
        "dataset": "municipality_results_long.csv",
        "strategy": "by_election",
        "shards": shards,
        "row_counts": row_counts,
    }
    shard_index_path = derived / "municipality_results_long_by_election.json"
    shard_index_path.write_text(json.dumps(shard_index, ensure_ascii=False, indent=2), encoding="utf-8")

    dataset_registry_path = derived / "dataset_registry.json"
    if dataset_registry_path.exists():
        dataset_registry = json.loads(dataset_registry_path.read_text(encoding="utf-8"))
        for dataset in dataset_registry.get("datasets") or []:
            key = str(dataset.get("election_key") or "")
            if key and key in shards:
                dataset["download_results"] = shards[key]
        dataset_registry_path.write_text(json.dumps(dataset_registry, ensure_ascii=False, indent=2), encoding="utf-8")

    data_products_path = derived / "data_products.json"
    if data_products_path.exists():
        data_products = json.loads(data_products_path.read_text(encoding="utf-8"))
        for product in data_products.get("products") or []:
            if product.get("product_key") == "camera_muni_historical":
                product["delivery_strategy"] = "monolith_plus_election_shards"
        data_products_path.write_text(json.dumps(data_products, ensure_ascii=False, indent=2), encoding="utf-8")

    provenance_path = derived / "provenance.json"
    if provenance_path.exists():
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        entries = provenance.get("entries") or []
        shard_step = "derivazione opzionale dei risultati di partito anche come shard per elezione"
        for entry in entries:
            if entry.get("dataset_key") == "municipalityResultsLong":
                steps = list(entry.get("transformation_steps") or [])
                if shard_step not in steps:
                    steps.append(shard_step)
                entry["transformation_steps"] = steps
        if not any(entry.get("dataset_key") == "municipalityResultsLongByElectionIndex" for entry in entries):
            entries.append({
                "dataset_key": "municipalityResultsLongByElectionIndex",
                "path": files["municipalityResultsLongByElectionIndex"],
                "produced_by": "build_result_shards.py",
                "source_class": "derived_bundle",
                "transformation_steps": [
                    "lettura del dataset municipality_results_long.csv già validato",
                    "scrittura di shard per election_key per caricamento progressivo lato app"
                ],
                "limitations": [
                    "gli shard non aggiungono copertura sostanziale: cambiano solo la strategia di consegna del bundle"
                ]
            })
        provenance["entries"] = entries
        provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")

    update_log_path = derived / "update_log.json"
    if update_log_path.exists():
        update_log = json.loads(update_log_path.read_text(encoding="utf-8"))
        update_log["entries"] = ensure_update_log_entry(list(update_log.get("entries") or []))
        update_log_path.write_text(json.dumps(update_log, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    release_manifest = {
        "generated_by": "build_result_shards.py",
        "project": manifest.get("project") or {},
        "bundle_root": ".",
        "file_entries": {},
    }
    for key, rel in files.items():
        if key == "releaseManifest":
            continue
        release_manifest["file_entries"][key] = summarize_file(root / rel, root)
    release_manifest["integrity"] = {
        "sha256_scope": sorted(release_manifest["file_entries"].keys()),
        "all_declared_files_present": all((root / rel).exists() for key, rel in files.items() if key != "releaseManifest")
    }
    (derived / "release_manifest.json").write_text(json.dumps(release_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "root": str(root),
        "manifest_version": project.get("version"),
        "shard_count": len(shards),
        "declared_rows": sum(row_counts.values()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
