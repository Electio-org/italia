#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
from typing import Dict, Iterator, List, Tuple

import pandas as pd

from party_taxonomy import apply_party_taxonomy_frame, resolve_party_meta
from preprocess import infer_party_meta
from territorial_history import harmonize_public_frames, load_crosswalk_frame


EXTRA_NOTE = "Party results can be delivered both as a monolithic CSV and as per-election shards for faster interactive loading."
SUMMARY_NOTE = "Municipality summary rows can also be delivered as per-election shards to reduce initial browser load."
ARCHIVE_GAP_NOTE = "The bundle can also declare a gap report that compares published coverage against the official Eligendo open-data archives."
CANONICAL_REBUILD_NOTE = "Municipality coverage is rebuilt from official Eligendo open-data zip archives across all Camera years plus Assemblea Costituente 1946."
PRODUCT_SYSTEM_NOTE = "Products are also published through a product catalog plus per-product manifests, not only through the bundle-wide manifest."
PRODUCT_INVENTORY_NOTE = "Every declared product also exposes a product-level inventory so users can see what is inside before loading the data."
WEB_GEOMETRY_NOTE = "The public app now reads a web-optimized geometry pack, while the full-resolution boundaries remain published as a separate product."
LOCAL_ASSET_NOTE = "Critical browser libraries are now vendored locally and the public documentation pages load only the metadata they actually need."
PROFILE_NOTE = "Municipality detail pages use province-sized compressed profile chunks instead of loading the national summary table."
TERRITORIAL_HISTORY_NOTE = "Public election shards are projected implicitly to the 2021 municipality geometry through a date-aware ISTAT SITUAS lineage; ambiguous splits are never allocated."
CURRENT_VERSION = "0.23.0"


def iter_election_frames(path: Path, chunk_size: int = 250_000) -> Iterator[Tuple[str, pd.DataFrame]]:
    """Stream a CSV that is ordered by election without retaining the national long table."""
    pending_key = ""
    pending: List[pd.DataFrame] = []
    completed = set()
    for chunk in pd.read_csv(path, dtype=str, chunksize=chunk_size):
        chunk = chunk.fillna("")
        if "election_key" not in chunk.columns:
            raise ValueError(f"Dataset senza election_key: {path}")
        for election_key, part in chunk.groupby("election_key", sort=False):
            election_key = str(election_key)
            if not pending_key:
                pending_key = election_key
            if election_key != pending_key:
                completed.add(pending_key)
                yield pending_key, pd.concat(pending, ignore_index=True)
                if election_key in completed:
                    raise ValueError(f"Il dataset non e ordinato per elezione: {path} ({election_key})")
                pending_key = election_key
                pending = []
            pending.append(part)
    if pending_key:
        yield pending_key, pd.concat(pending, ignore_index=True)


def latest_geometry_rel(derived: Path, folder: str, prefix: str, root: Path) -> str:
    # Prefer TopoJSON over GeoJSON when both siblings exist; this is the
    # runtime format for `geometries_web/` and keeps the legacy `.geojson`
    # fallback for `geometries/` (full-res) and older pipelines.
    topo = sorted((derived / folder).glob(f"{prefix}_*.topojson"))
    if topo:
        return str(topo[-1].relative_to(root)).replace("\\", "/")
    geo = sorted((derived / folder).glob(f"{prefix}_*.geojson"))
    if geo:
        return str(geo[-1].relative_to(root)).replace("\\", "/")
    return ""


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
    with path.open("rb") as head:
        prefix = head.read(160)
    if prefix.startswith(b"version https://git-lfs.github.com/spec/v1"):
        info["kind"] = "git-lfs-pointer"
        return info
    if path.suffix.lower() == ".csv" or path.name.lower().endswith(".csv.gz"):
        opener = gzip.open if path.name.lower().endswith(".csv.gz") else path.open
        with opener(path, "rt", encoding="utf-8", newline="") if path.name.lower().endswith(".csv.gz") else opener(encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            info["columns"] = list(reader.fieldnames or [])
            info["row_count"] = sum(1 for _ in reader)
    elif path.suffix.lower() in {".json", ".geojson", ".topojson"}:
        obj = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(obj, dict):
            if isinstance(obj.get("features"), list):
                info["feature_count"] = len(obj.get("features") or [])
            elif isinstance(obj.get("objects"), dict):
                # TopoJSON: count features inside the first object collection.
                first = next(iter(obj["objects"].values()), None)
                if isinstance(first, dict) and isinstance(first.get("geometries"), list):
                    info["feature_count"] = len(first["geometries"])
            elif isinstance(obj.get("datasets"), list):
                info["dataset_count"] = len(obj.get("datasets") or [])
            elif isinstance(obj.get("products"), list):
                info["product_count"] = len(obj.get("products") or [])
            elif isinstance(obj.get("entries"), list):
                info["entry_count"] = len(obj.get("entries") or [])
    return info


def slugify(value: str) -> str:
    return str(value).strip().lower().replace(" ", "_")


def update_party_catalog(catalog: Dict[str, Dict[str, object]], frame: pd.DataFrame) -> None:
    if frame.empty:
        return
    work = frame.copy()
    work["votes"] = pd.to_numeric(work["votes"], errors="coerce").fillna(0)
    grouped = (
        work.groupby(
            ["election_key", "election_year", "party_raw", "party_std", "party_family", "bloc"],
            dropna=False,
            sort=False,
        )["votes"]
        .sum()
        .reset_index()
    )
    for row in grouped.to_dict("records"):
        party_std = str(row.get("party_std") or row.get("party_raw") or "").strip()
        party_raw = str(row.get("party_raw") or party_std).strip()
        if not party_std:
            continue
        entry = catalog.setdefault(
            party_std,
            {"aliases": set(), "years": set(), "variants": {}, "colors": {}},
        )
        entry["aliases"].add(party_raw)
        year = int(float(row.get("election_year") or 0))
        if year:
            entry["years"].add(year)
        votes = float(row.get("votes") or 0)
        variant = (str(row.get("party_family") or "altro"), str(row.get("bloc") or "altro"))
        entry["variants"][variant] = entry["variants"].get(variant, 0.0) + votes
        meta = resolve_party_meta(row.get("election_key"), party_raw, infer_party_meta)
        color = str(meta.get("color") or "#64748b")
        entry["colors"][color] = entry["colors"].get(color, 0.0) + votes


def write_parties_master(catalog: Dict[str, Dict[str, object]], output: Path) -> None:
    rows = []
    for party_std, entry in catalog.items():
        variants = entry.get("variants") or {("altro", "altro"): 0}
        family, bloc = max(variants.items(), key=lambda item: item[1])[0]
        colors = entry.get("colors") or {"#64748b": 0}
        color = max(colors.items(), key=lambda item: item[1])[0]
        years = sorted(entry.get("years") or [])
        rows.append({
            "party_std": party_std,
            "party_display_name": party_std,
            "party_family": family,
            "bloc": bloc,
            "color": color,
            "aliases": "|".join(sorted(entry.get("aliases") or [], key=str.casefold)),
            "valid_from": years[0] if years else "",
            "valid_to": years[-1] if years else "",
            "comparability_note": "election_aware_taxonomy|observed_election_range_not_legal_lifetime|raw_aliases_preserved",
        })
    rows.sort(key=lambda row: (int(row["valid_from"] or 9999), str(row["party_std"]).casefold()))
    columns = ["party_std", "party_display_name", "party_family", "bloc", "color", "aliases", "valid_from", "valid_to", "comparability_note"]
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def ensure_update_log_entry(entries: List[Dict[str, object]]) -> List[Dict[str, object]]:
    current = {
        "version": CURRENT_VERSION,
        "date": "2026-07-15",
        "title": "Election-aware party taxonomy and national audit",
        "changes": [
            "Added election-specific exact mappings for historical party names that collided with modern identities.",
            "Applied party taxonomy before territorial aggregation so winners, shares and dominant blocks use corrected identities.",
            "Added national winner/share guardrails for every published election from 1946 to 2022.",
            "Published a machine-readable taxonomy audit with unmatched-share and block-distribution diagnostics.",
            "Kept raw list labels unchanged and marked exact editorial classifications separately from fallback rules."
        ]
    }
    return [current, *[entry for entry in entries if str(entry.get("version")) != CURRENT_VERSION]]


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
    project["title"] = "Electio Italia"
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
    if PROFILE_NOTE not in notes:
        notes.append(PROFILE_NOTE)
    if TERRITORIAL_HISTORY_NOTE not in notes:
        notes.append(TERRITORIAL_HISTORY_NOTE)
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
    files["territorialCrosswalk"] = "data/derived/municipality_election_crosswalk.csv.gz"
    files["territorialHistoryReport"] = "data/derived/territorial_history_report.json"
    files["territorialSources"] = "data/reference/territorial_sources.json"
    files["municipalityRegistryByElection"] = "data/reference/municipality_registry_by_election.csv.gz"
    files["municipalityRegistryHistorical"] = "data/reference/municipality_registry_historical_anpr.csv.gz"
    files["territorialEvents"] = "data/reference/situas_municipality_events_1861_2021.csv.gz"
    files["partyTaxonomy"] = "data/reference/party_taxonomy_overrides.csv"
    files["partyTaxonomyAudit"] = "data/derived/party_taxonomy_audit.json"
    files["nationalElectionChecks"] = "data/reference/national_election_checks.csv"
    files["municipalitySummaryByElectionIndex"] = "data/derived/municipality_summary_by_election.json"
    files["municipalityResultsLongByElectionIndex"] = "data/derived/municipality_results_long_by_election.json"
    if (derived / "municipality_profiles" / "index.json").exists():
        files["municipalityProfileIndex"] = "data/derived/municipality_profiles/index.json"
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
    summary_by_key = {
        str(election_key): chunk.copy()
        for election_key, chunk in summary.groupby("election_key", sort=False)
    }
    crosswalk_path = derived / "municipality_election_crosswalk.csv.gz"
    if not crosswalk_path.exists():
        raise SystemExit("Crosswalk territoriale mancante. Esegui prima scripts/build_territorial_history.py")
    crosswalk = load_crosswalk_frame(crosswalk_path)
    summary_shard_dir = derived / "summary_by_election"
    summary_shard_dir.mkdir(parents=True, exist_ok=True)
    for old in summary_shard_dir.glob("*.csv"):
        old.unlink()

    summary_shards: Dict[str, str] = {}
    summary_row_counts: Dict[str, int] = {}

    results_path = derived / "municipality_results_long.csv"
    shard_dir = derived / "results_by_election"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for old in shard_dir.glob("*.csv"):
        old.unlink()

    shards: Dict[str, str] = {}
    row_counts: Dict[str, int] = {}
    party_catalog: Dict[str, Dict[str, object]] = {}
    processed = set()
    for election_key, raw_results in iter_election_frames(results_path):
        raw_summary = summary_by_key.get(election_key)
        if raw_summary is None:
            raise ValueError(f"Summary mancante per {election_key}")
        harmonized_summary, harmonized_results = harmonize_public_frames(
            raw_summary,
            raw_results,
            crosswalk,
            results_transform=lambda frame: apply_party_taxonomy_frame(frame, infer_party_meta),
        )

        summary_filename = f"{slugify(election_key)}.csv"
        summary_output = summary_shard_dir / summary_filename
        harmonized_summary.to_csv(summary_output, index=False)
        summary_shards[election_key] = str(summary_output.relative_to(root)).replace("\\", "/")
        summary_row_counts[election_key] = int(len(harmonized_summary))

        results_filename = f"{slugify(election_key)}.csv"
        results_output = shard_dir / results_filename
        harmonized_results.to_csv(results_output, index=False)
        update_party_catalog(party_catalog, harmonized_results)
        shards[election_key] = str(results_output.relative_to(root)).replace("\\", "/")
        row_counts[election_key] = int(len(harmonized_results))
        processed.add(election_key)

    missing_elections = sorted(set(summary_by_key) - processed)
    if missing_elections:
        raise ValueError(f"Risultati mancanti per: {', '.join(missing_elections)}")
    write_parties_master(party_catalog, derived / "parties_master.csv")

    summary_shard_index = {
        "generated_by": "build_result_shards.py",
        "dataset": "municipality_summary_harmonized_to_2021_geometry",
        "source_dataset": "data/derived/municipality_summary.csv",
        "territorial_mode": "harmonized",
        "target_geometry_date": "2021-12-31",
        "crosswalk": "data/derived/municipality_election_crosswalk.csv.gz",
        "strategy": "by_election",
        "shards": summary_shards,
        "row_counts": summary_row_counts,
    }
    summary_shard_index_path = derived / "municipality_summary_by_election.json"
    summary_shard_index_path.write_text(json.dumps(summary_shard_index, ensure_ascii=False, indent=2), encoding="utf-8")

    shard_index = {
        "generated_by": "build_result_shards.py",
        "dataset": "municipality_results_long_harmonized_to_2021_geometry",
        "source_dataset": "data/derived/municipality_results_long.csv",
        "territorial_mode": "harmonized",
        "target_geometry_date": "2021-12-31",
        "crosswalk": "data/derived/municipality_election_crosswalk.csv.gz",
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
            ],
            "territorial_history_2021": [
                "ricerca dei comuni storici tramite alias e successioni amministrative",
                "proiezione riproducibile delle elezioni sulla geometria comunale 2021",
                "audit delle eccezioni non allocabili senza inventare voti"
            ]
        }
        for product in data_products.get("products") or []:
            if product.get("product_key") == "camera_muni_historical":
                product["title"] = "Camera e Costituente - fonte storica e vista comunale 2021"
                product["territorial_mode"] = "source_monolith_and_harmonized_public_shards"
                product["delivery_strategy"] = "raw_source_geography_monolith_plus_2021_harmonized_election_shards"
                product["intended_use"] = intended_use_defaults["camera_muni_historical"]
                extras = list(product.get("extra_dataset_keys") or [])
                for key in ["territorialCrosswalk", "territorialHistoryReport"]:
                    if key not in extras:
                        extras.append(key)
                product["extra_dataset_keys"] = extras
                product["guardrails"] = [
                    "I CSV monolitici conservano la geografia osservata nella fonte Eligendo.",
                    "La dashboard e gli shard per elezione usano la proiezione implicita sulla geometria 2021.",
                    "Scissioni ambigue e trasferimenti parziali restano no-data senza una chiave ufficiale."
                ]
            if product.get("product_key") == "geometry_pack_italy":
                product["title"] = "Pacchetto geometrie Italia - web"
            if product.get("product_key") == "geometry_pack_italy_full":
                product["title"] = "Pacchetto geometrie Italia - full"
            if not (product.get("intended_use") or []):
                product["intended_use"] = intended_use_defaults.get(str(product.get("product_key") or ""), [])
        if not any(product.get("product_key") == "territorial_history_2021" for product in data_products.get("products") or []):
            data_products.setdefault("products", []).append({
                "product_key": "territorial_history_2021",
                "title": "Storia territoriale dei comuni e crosswalk elettorale 2021",
                "kind": "temporal_crosswalk",
                "territorial_mode": "date_aware_harmonized",
                "granularity": "municipality-election",
                "primary_dataset_key": "territorialCrosswalk",
                "companion_dataset_key": "territorialHistoryReport",
                "extra_dataset_keys": ["territorialLineage", "municipalityAliases", "territorialSources"],
                "join_keys": ["election_key", "source_municipality_id", "target_geometry_id"],
                "guardrails": [
                    "Solo successioni complete e deterministiche vengono proiettate automaticamente.",
                    "Le scissioni senza pesi ufficiali non vengono distribuite tra i comuni discendenti."
                ],
                "delivery_strategy": "compact_gzip_crosswalk_plus_machine_readable_report",
                "intended_use": intended_use_defaults["territorial_history_2021"]
            })
        data_products_path.write_text(json.dumps(data_products, ensure_ascii=False, indent=2), encoding="utf-8")

    provenance_path = derived / "provenance.json"
    if provenance_path.exists():
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        entries = provenance.get("entries") or []
        summary_shard_step = "proiezione implicita degli shard pubblici sulla geometria comunale 2021 tramite crosswalk temporale SITUAS"
        shard_step = "aggregazione dei voti dei predecessori completi sulla geometria comunale 2021 prima della scrittura degli shard"
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
                    "lettura del dataset municipality_summary.csv nella geografia osservata alla fonte",
                    "join con il crosswalk valido alla data dell'elezione",
                    "aggregazione dei predecessori completi e ricalcolo di affluenza, leader e margine",
                    "scrittura di shard per election_key sulla geometria 2021"
                ],
                "limitations": [
                    "scissioni ambigue e trasferimenti territoriali parziali non vengono allocati senza una chiave ufficiale"
                ]
            })
        if not any(entry.get("dataset_key") == "municipalityResultsLongByElectionIndex" for entry in entries):
            entries.append({
                "dataset_key": "municipalityResultsLongByElectionIndex",
                "path": files["municipalityResultsLongByElectionIndex"],
                "produced_by": "build_result_shards.py",
                "source_class": "derived_bundle",
                "transformation_steps": [
                    "lettura del dataset municipality_results_long.csv nella geografia osservata alla fonte",
                    "join con il crosswalk valido alla data dell'elezione",
                    "somma dei voti dei predecessori completi e ricalcolo di quote e rank",
                    "scrittura di shard per election_key sulla geometria 2021"
                ],
                "limitations": [
                    "scissioni ambigue e trasferimenti territoriali parziali non vengono allocati senza una chiave ufficiale"
                ]
            })
        territorial_entries = {
            "territorialCrosswalk": {
                "produced_by": "build_territorial_history.py",
                "source_class": "derived_crosswalk",
                "transformation_steps": [
                    "identificazione del comune valido alla data dell'elezione",
                    "percorso temporale degli eventi ES, AP e RN fino alla geometria 2021",
                    "classificazione esplicita di risolto, scissione ambigua o irrisolto"
                ],
                "limitations": ["non distribuisce voti tra discendenti quando manca una chiave ufficiale di allocazione"]
            },
            "territorialHistoryReport": {
                "produced_by": "build_territorial_history.py",
                "source_class": "quality_report",
                "transformation_steps": ["conteggio della copertura del crosswalk per elezione e metodo di risoluzione"],
                "limitations": ["le eccezioni restano visibili nel report ma non vengono forzate sulla mappa"]
            },
            "territorialSources": {
                "produced_by": "build_territorial_history.py",
                "source_class": "source_metadata",
                "transformation_steps": ["dichiarazione di fonti, ruoli e politica di armonizzazione territoriale"],
                "limitations": []
            }
        }
        for dataset_key, spec in territorial_entries.items():
            if any(entry.get("dataset_key") == dataset_key for entry in entries):
                continue
            entries.append({"dataset_key": dataset_key, "path": files[dataset_key], **spec})
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
            if not inventory_entries:
                inventory_kind = "declared_datasets"
                inventory_entries = [
                    {
                        "dataset_key": entry.get("dataset_key"),
                        "role": entry.get("role"),
                        "path": entry.get("path"),
                        "kind": entry.get("kind"),
                        "size_bytes": entry.get("size_bytes"),
                        "row_count": entry.get("row_count"),
                    }
                    for entry in dataset_entries
                ]

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
