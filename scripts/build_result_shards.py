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
SUMMARY_NOTE = "Municipality summary rows can also be delivered as per-election shards to reduce initial browser load."
ARCHIVE_GAP_NOTE = "The bundle can also declare a gap report that compares published coverage against the official Eligendo open-data archives."
CANONICAL_REBUILD_NOTE = "Municipality coverage is rebuilt from official Eligendo open-data zip archives across all Camera years plus Assemblea Costituente 1946."
PRODUCT_SYSTEM_NOTE = "Products are also published through a product catalog plus per-product manifests, not only through the bundle-wide manifest."
PRODUCT_INVENTORY_NOTE = "Every declared product also exposes a product-level inventory so users can see what is inside before loading the data."
WEB_GEOMETRY_NOTE = "The public app now reads a web-optimized geometry pack, while the full-resolution boundaries remain published as a separate product."
LOCAL_ASSET_NOTE = "Critical browser libraries are now vendored locally and the public documentation pages load only the metadata they actually need."
CURRENT_VERSION = "0.21.0"


def latest_geometry_rel(derived: Path, folder: str, prefix: str, root: Path) -> str:
    paths = sorted((derived / folder).glob(f"{prefix}_*.geojson"))
    if not paths:
        return ""
    return str(paths[-1].relative_to(root)).replace("\\", "/")


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
        "title": "National Camera bundle, web/full geometry split, and lighter public metadata loading",
        "changes": [
            "Rebuilt 1946-2022 municipality summary and party results from the official Eligendo open-data zip archives for Assemblea Costituente and Camera.",
            "Shifted the primary source from HTML archive navigation to the national open-data bundles, keeping HTML only as QA and fallback.",
            "Added by-election shards for municipality_summary.csv and municipality_results_long.csv.",
            "Declared deferred loading for municipality summary and party results in manifest.json.",
            "Aligned dataset registry, provenance, and release metadata to the shard-based delivery layout.",
            "Added a product catalog plus per-product manifests so the bundle can be navigated as product families, not only as a flat file list.",
            "Added product-level inventories that declare which election datasets, geometry years, or metadata objects are inside each product.",
            "Split Italy boundary delivery into a web-optimized geometry pack for the public app plus a full-resolution geometry product for heavier downstream use.",
            "Vendored the critical browser libraries locally so the dashboard no longer depends on public CDNs at runtime.",
            "Trimmed the documentation pages so each route fetches only the metadata layer it actually needs.",
            "Added an official-source-vs-bundle gap report to make residual coverage and geometry-join gaps explicit in the public bundle.",
            "Release manifest paths are now web-relative, so declared downloads stay usable inside the static site."
        ]
    }, *entries]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build municipality summary/result shards and refresh bundle metadata.")
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
    project["title"] = "Italia Camera Explorer"
    notes = list(project.get("notes") or [])
    if EXTRA_NOTE not in notes:
        notes.append(EXTRA_NOTE)
    if SUMMARY_NOTE not in notes:
        notes.append(SUMMARY_NOTE)
    if ARCHIVE_GAP_NOTE not in notes:
        notes.append(ARCHIVE_GAP_NOTE)
    if CANONICAL_REBUILD_NOTE not in notes:
        notes.append(CANONICAL_REBUILD_NOTE)
    if PRODUCT_SYSTEM_NOTE not in notes:
        notes.append(PRODUCT_SYSTEM_NOTE)
    if PRODUCT_INVENTORY_NOTE not in notes:
        notes.append(PRODUCT_INVENTORY_NOTE)
    if WEB_GEOMETRY_NOTE not in notes:
        notes.append(WEB_GEOMETRY_NOTE)
    if LOCAL_ASSET_NOTE not in notes:
        notes.append(LOCAL_ASSET_NOTE)
    project["notes"] = notes

    files = manifest.setdefault("files", {})
    if (derived / "geometry_pack_web.json").exists():
        files["geometryPack"] = "data/derived/geometry_pack_web.json"
    web_geometry = latest_geometry_rel(derived, "geometries_web", "municipalities", root)
    web_province_geometry = latest_geometry_rel(derived, "geometries_web", "provinces", root)
    if web_geometry:
        files["geometry"] = web_geometry
    if web_province_geometry:
        files["provinceGeometry"] = web_province_geometry
    if (derived / "geometry_pack_full.json").exists():
        files["geometryPackFull"] = "data/derived/geometry_pack_full.json"
    elif (derived / "geometry_pack.json").exists():
        files["geometryPackFull"] = "data/derived/geometry_pack.json"
    full_geometry = latest_geometry_rel(derived, "geometries", "municipalities", root)
    full_province_geometry = latest_geometry_rel(derived, "geometries", "provinces", root)
    if full_geometry:
        files["geometryFull"] = full_geometry
    if full_province_geometry:
        files["provinceGeometryFull"] = full_province_geometry
    if (derived / "web_geometry_report.json").exists():
        files["webGeometryReport"] = "data/derived/web_geometry_report.json"
    files["productCatalog"] = "data/products/product_catalog.json"
    files["municipalitySummaryByElectionIndex"] = "data/derived/municipality_summary_by_election.json"
    files["municipalityResultsLongByElectionIndex"] = "data/derived/municipality_results_long_by_election.json"
    manifest["loading"] = {
        "municipalitySummary": {
            "strategy": "deferred_by_election",
            "index": "data/derived/municipality_summary_by_election.json"
        },
        "municipalityResultsLong": {
            "strategy": "deferred_by_election",
            "index": "data/derived/municipality_results_long_by_election.json"
        }
    }

    summary_path = derived / "municipality_summary.csv"
    summary = pd.read_csv(summary_path, dtype=str).fillna("")
    summary_shard_dir = derived / "summary_by_election"
    summary_shard_dir.mkdir(parents=True, exist_ok=True)
    for old in summary_shard_dir.glob("*.csv"):
        old.unlink()

    summary_shards: Dict[str, str] = {}
    summary_row_counts: Dict[str, int] = {}
    if not summary.empty and "election_key" in summary.columns:
        for election_key, chunk in sorted(summary.groupby("election_key"), key=lambda item: str(item[0])):
            filename = f"{slugify(str(election_key))}.csv"
            path = summary_shard_dir / filename
            chunk.to_csv(path, index=False)
            summary_shards[str(election_key)] = str(path.relative_to(root)).replace("\\", "/")
            summary_row_counts[str(election_key)] = int(len(chunk))

    summary_shard_index = {
        "generated_by": "build_result_shards.py",
        "dataset": "municipality_summary.csv",
        "strategy": "by_election",
        "shards": summary_shards,
        "row_counts": summary_row_counts,
    }
    summary_shard_index_path = derived / "municipality_summary_by_election.json"
    summary_shard_index_path.write_text(json.dumps(summary_shard_index, ensure_ascii=False, indent=2), encoding="utf-8")

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
    dataset_registry_rows: List[Dict[str, object]] = []
    if dataset_registry_path.exists():
        dataset_registry = json.loads(dataset_registry_path.read_text(encoding="utf-8"))
        dataset_registry_rows = list(dataset_registry.get("datasets") or [])
        for dataset in dataset_registry.get("datasets") or []:
            key = str(dataset.get("election_key") or "")
            if key and key in summary_shards:
                dataset["download_summary"] = summary_shards[key]
            if key and key in shards:
                dataset["download_results"] = shards[key]
        dataset_registry_path.write_text(json.dumps(dataset_registry, ensure_ascii=False, indent=2), encoding="utf-8")

    data_products_path = derived / "data_products.json"
    data_products = None
    if data_products_path.exists():
        data_products = json.loads(data_products_path.read_text(encoding="utf-8"))
        intended_use_defaults = {
            "camera_muni_historical": [
                "analisi storica comunale della Camera e dell'Assemblea Costituente in Italia",
                "dashboard pubblica e download per anno o release",
                "base primaria per confronto territoriale e profili comunali"
            ],
            "geometry_pack_italy": [
                "cartografia web ottimizzata con basi annuali dichiarate",
                "caricamento piu leggero della dashboard pubblica",
                "join geografico esplicito via geometry_id e municipality_id"
            ],
            "geometry_pack_italy_full": [
                "download e ricerca con geometrie complete",
                "riuso esterno dove la fedelta geometrica conta piu della velocita",
                "join geografico esplicito via geometry_id e municipality_id"
            ],
            "metadata_layer": [
                "audit della release, codebook, guardrail e provenance",
                "documentazione machine-readable del bundle"
            ]
        }
        for product in data_products.get("products") or []:
            if product.get("product_key") == "camera_muni_historical":
                product["title"] = "Camera e Costituente Italia - comuni storici"
                product["delivery_strategy"] = "summary_and_results_monolith_plus_election_shards"
                product["intended_use"] = intended_use_defaults["camera_muni_historical"]
            if product.get("product_key") == "geometry_pack_italy":
                product["title"] = "Pacchetto geometrie Italia - web"
            if product.get("product_key") == "geometry_pack_italy_full":
                product["title"] = "Pacchetto geometrie Italia - full"
            if not (product.get("intended_use") or []):
                product["intended_use"] = intended_use_defaults.get(str(product.get("product_key") or ""), [])
        data_products_path.write_text(json.dumps(data_products, ensure_ascii=False, indent=2), encoding="utf-8")

    provenance_path = derived / "provenance.json"
    if provenance_path.exists():
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        entries = provenance.get("entries") or []
        summary_shard_step = "derivazione opzionale del municipality_summary anche come shard per elezione"
        shard_step = "derivazione opzionale dei risultati di partito anche come shard per elezione"
        for entry in entries:
            if entry.get("dataset_key") == "municipalitySummary":
                steps = list(entry.get("transformation_steps") or [])
                if summary_shard_step not in steps:
                    steps.append(summary_shard_step)
                entry["transformation_steps"] = steps
        for entry in entries:
            if entry.get("dataset_key") == "municipalityResultsLong":
                steps = list(entry.get("transformation_steps") or [])
                if shard_step not in steps:
                    steps.append(shard_step)
                entry["transformation_steps"] = steps
        if not any(entry.get("dataset_key") == "municipalitySummaryByElectionIndex" for entry in entries):
            entries.append({
                "dataset_key": "municipalitySummaryByElectionIndex",
                "path": files["municipalitySummaryByElectionIndex"],
                "produced_by": "build_result_shards.py",
                "source_class": "derived_bundle",
                "transformation_steps": [
                    "lettura del dataset municipality_summary.csv gia validato",
                    "scrittura di shard per election_key per caricamento progressivo lato app"
                ],
                "limitations": [
                    "gli shard non aggiungono copertura sostanziale: cambiano solo la strategia di consegna del bundle"
                ]
            })
        if not any(entry.get("dataset_key") == "municipalityResultsLongByElectionIndex" for entry in entries):
            entries.append({
                "dataset_key": "municipalityResultsLongByElectionIndex",
                "path": files["municipalityResultsLongByElectionIndex"],
                "produced_by": "build_result_shards.py",
                "source_class": "derived_bundle",
                "transformation_steps": [
                    "lettura del dataset municipality_results_long.csv gia validato",
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

    product_catalog_dir = root / "data" / "products"
    product_catalog_dir.mkdir(parents=True, exist_ok=True)
    release_date = ((update_log.get("entries") or [{}])[0].get("date") if 'update_log' in locals() else None)
    product_catalog_items: List[Dict[str, object]] = []
    geometry_pack_payload = json.loads((root / files["geometryPack"]).read_text(encoding="utf-8")) if files.get("geometryPack") and (root / files["geometryPack"]).exists() else {}
    geometry_pack_full_payload = json.loads((root / files["geometryPackFull"]).read_text(encoding="utf-8")) if files.get("geometryPackFull") and (root / files["geometryPackFull"]).exists() else geometry_pack_payload
    product_manifest_step = "pubblicazione del sistema prodotti con catalogo e manifest dedicati per ogni product_key"
    if data_products:
        clients = list(data_products.get("clients") or [])
        for product in data_products.get("products") or []:
            product_key = str(product.get("product_key") or slugify(product.get("title") or "product"))
            product_dir = product_catalog_dir / product_key
            product_dir.mkdir(parents=True, exist_ok=True)
            role_specs = []
            if product.get("primary_dataset_key"):
                role_specs.append(("primary", str(product["primary_dataset_key"])))
            if product.get("companion_dataset_key"):
                role_specs.append(("companion", str(product["companion_dataset_key"])))
            for extra in product.get("extra_dataset_keys") or []:
                if extra:
                    role_specs.append(("extra", str(extra)))
            dataset_entries: List[Dict[str, object]] = []
            for role, dataset_key in role_specs:
                rel = files.get(dataset_key)
                if not rel:
                    continue
                meta = summarize_file(root / rel, root)
                entry = {
                    "role": role,
                    "dataset_key": dataset_key,
                    "path": rel,
                    "kind": meta.get("kind"),
                    "size_bytes": meta.get("size_bytes"),
                    "row_count": meta.get("row_count"),
                    "feature_count": meta.get("feature_count"),
                    "sha256": meta.get("sha256"),
                }
                if dataset_key == "municipalitySummary" and files.get("municipalitySummaryByElectionIndex"):
                    entry["delivery_strategy"] = manifest.get("loading", {}).get("municipalitySummary", {}).get("strategy")
                    entry["by_election_index"] = files["municipalitySummaryByElectionIndex"]
                if dataset_key == "municipalityResultsLong" and files.get("municipalityResultsLongByElectionIndex"):
                    entry["delivery_strategy"] = manifest.get("loading", {}).get("municipalityResultsLong", {}).get("strategy")
                    entry["by_election_index"] = files["municipalityResultsLongByElectionIndex"]
                dataset_entries.append(entry)

            inventory_kind = "flat"
            inventory_entries: List[Dict[str, object]] = []
            if product_key == "camera_muni_historical":
                inventory_kind = "election_datasets"
                allowed_families = {"assemblea_costituente_municipality_historical", "camera_municipality_historical"}
                def registry_sort_key(item: Dict[str, object]) -> tuple[int, str]:
                    try:
                        year = int(item.get("election_year") or 0)
                    except Exception:
                        year = 0
                    return year, str(item.get("election_key") or "")

                for row in sorted(dataset_registry_rows, key=registry_sort_key):
                    if str(row.get("dataset_family") or "") not in allowed_families:
                        continue
                    inventory_entries.append({
                        "dataset_key": row.get("dataset_key"),
                        "dataset_family": row.get("dataset_family"),
                        "election_key": row.get("election_key"),
                        "election_year": row.get("election_year"),
                        "coverage_label": row.get("coverage_label"),
                        "status": row.get("status"),
                        "summary_rows": row.get("summary_rows"),
                        "result_rows": row.get("result_rows"),
                        "download_summary": row.get("download_summary"),
                        "download_results": row.get("download_results"),
                    })
            elif product_key in {"geometry_pack_italy", "geometry_pack_italy_full"}:
                inventory_kind = "boundary_years"
                source_pack = geometry_pack_full_payload if product_key == "geometry_pack_italy_full" else geometry_pack_payload
                municipalities = source_pack.get("municipalities") or {}
                provinces = source_pack.get("provinces") or {}
                years = source_pack.get("availableYears") or sorted({*municipalities.keys(), *provinces.keys()}, key=lambda value: int(value))
                for year in years:
                    inventory_entries.append({
                        "geometry_year": int(year),
                        "municipalities_path": municipalities.get(str(year)),
                        "provinces_path": provinces.get(str(year)),
                    })
            elif product_key == "metadata_layer":
                inventory_kind = "metadata_objects"
                for dataset_key in [product.get("primary_dataset_key"), product.get("companion_dataset_key"), *(product.get("extra_dataset_keys") or [])]:
                    if not dataset_key:
                        continue
                    rel = files.get(str(dataset_key))
                    if not rel:
                        continue
                    meta = summarize_file(root / rel, root)
                    inventory_entries.append({
                        "dataset_key": dataset_key,
                        "path": rel,
                        "kind": meta.get("kind"),
                        "size_bytes": meta.get("size_bytes"),
                        "row_count": meta.get("row_count"),
                        "feature_count": meta.get("feature_count"),
                    })

            product_manifest = {
                "generated_by": "build_result_shards.py",
                "release_version": CURRENT_VERSION,
                "release_date": release_date,
                "product": {
                    "product_key": product_key,
                    "title": product.get("title"),
                    "kind": product.get("kind"),
                    "territorial_mode": product.get("territorial_mode"),
                    "granularity": product.get("granularity"),
                    "delivery_strategy": product.get("delivery_strategy"),
                    "primary_dataset_key": product.get("primary_dataset_key"),
                    "companion_dataset_key": product.get("companion_dataset_key"),
                    "extra_dataset_keys": product.get("extra_dataset_keys") or [],
                    "join_keys": product.get("join_keys") or [],
                    "guardrails": product.get("guardrails") or [],
                    "intended_use": product.get("intended_use") or [],
                },
                "datasets": dataset_entries,
                "inventory": {
                    "kind": inventory_kind,
                    "entry_count": len(inventory_entries),
                    "entries": inventory_entries,
                },
                "clients": clients,
                "bundle_manifest": "data/derived/manifest.json",
            }
            product_manifest_path = product_dir / "manifest.json"
            product_manifest_path.write_text(json.dumps(product_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            product_catalog_items.append({
                "product_key": product_key,
                "title": product.get("title"),
                "kind": product.get("kind"),
                "territorial_mode": product.get("territorial_mode"),
                "granularity": product.get("granularity"),
                "delivery_strategy": product.get("delivery_strategy"),
                "manifest_path": str(product_manifest_path.relative_to(root)).replace("\\", "/"),
                "dataset_count": len(dataset_entries),
                "primary_dataset_key": product.get("primary_dataset_key"),
                "companion_dataset_key": product.get("companion_dataset_key"),
                "extra_dataset_keys": product.get("extra_dataset_keys") or [],
                "guardrails": product.get("guardrails") or [],
                "join_keys": product.get("join_keys") or [],
                "intended_use": product.get("intended_use") or [],
                "inventory_kind": inventory_kind,
                "inventory_count": len(inventory_entries),
                "inventory_preview": [entry.get("election_key") or entry.get("geometry_year") or entry.get("dataset_key") for entry in inventory_entries[:4]],
            })
    product_catalog = {
        "generated_by": "build_result_shards.py",
        "release_version": CURRENT_VERSION,
        "release_date": release_date,
        "products": product_catalog_items,
    }
    product_catalog_path = product_catalog_dir / "product_catalog.json"
    product_catalog_path.write_text(json.dumps(product_catalog, ensure_ascii=False, indent=2), encoding="utf-8")

    if provenance_path.exists():
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        entries = provenance.get("entries") or []
        if not any(entry.get("dataset_key") == "productCatalog" for entry in entries):
            entries.append({
                "dataset_key": "productCatalog",
                "path": files["productCatalog"],
                "produced_by": "build_result_shards.py",
                "source_class": "derived_bundle",
                "transformation_steps": [
                    product_manifest_step,
                    "normalizzazione dei data products dichiarati in un indice di prodotti leggibile da codice e dal sito"
                ],
                "limitations": [
                    "i product manifest non creano nuovi dati: organizzano i dataset esistenti in prodotti piu espliciti"
                ]
            })
            provenance["entries"] = entries
            provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest["files"] = files
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
    for product in product_catalog_items:
        manifest_path = product.get("manifest_path")
        product_key = product.get("product_key") or "product"
        if manifest_path:
            release_manifest["file_entries"][f"productManifest:{product_key}"] = summarize_file(root / str(manifest_path), root)
    release_manifest["integrity"] = {
        "sha256_scope": sorted(release_manifest["file_entries"].keys()),
        "all_declared_files_present": all((root / rel).exists() for key, rel in files.items() if key != "releaseManifest")
    }
    (derived / "release_manifest.json").write_text(json.dumps(release_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "root": str(root),
        "manifest_version": project.get("version"),
        "product_count": len(product_catalog_items),
        "summary_shard_count": len(summary_shards),
        "shard_count": len(shards),
        "declared_summary_rows": sum(summary_row_counts.values()),
        "declared_rows": sum(row_counts.values()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
