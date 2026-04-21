#!/usr/bin/env python3
"""
Preprocessing infrastructure for Electio Italia.

Goals for this hardened version:
- never invent electoral data
- recalculate vote shares from votes whenever a denominator is available
- add plausibility checks on derived outputs
- keep all fallbacks explicit in comparability notes / audit output
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import pandas as pd

try:
    from ftfy import fix_text
except Exception:  # pragma: no cover - optional dependency in dev/runtime
    def fix_text(value: str) -> str:
        return value

CONTRACTS = {
    "municipalities_master.csv": [
        "municipality_id","name_current","name_historical","province_current","province_code_current","region","geometry_id","valid_from","valid_to","active_current","source_status","alias_names","lineage_note","harmonized_group_id"
    ],
    "parties_master.csv": [
        "party_std","party_display_name","party_family","bloc","color","aliases","valid_from","valid_to","comparability_note"
    ],
    "territorial_lineage.csv": [
        "municipality_id_stable","name_current","name_historical","valid_from","valid_to","parent_ids","child_ids","event_type","merge_event","split_event","rename_event","province_history","geometry_strategy","notes"
    ],
    "municipality_summary.csv": [
        "election_key","election_year","election_date","municipality_id","municipality_name","province","region","geometry_id","territorial_mode","territorial_status","turnout_pct","electors","voters","valid_votes","total_votes","first_party_std","first_party_share","second_party_std","second_party_share","first_second_margin","dominant_block","comparability_note","completeness_flag"
    ],
    "municipality_results_long.csv": [
        "election_key","election_year","election_date","municipality_id","municipality_name","province","region","party_raw","party_std","party_family","bloc","votes","vote_share","rank","territorial_mode","territorial_status","geometry_id","comparability_note"
    ],
    "municipality_aliases.csv": [
        "municipality_id","alias","alias_type","valid_from","valid_to","notes"
    ],
    "custom_indicators.csv": [
        "indicator_key","indicator_label","municipality_id","election_key","election_year","value","source","notes","territorial_mode"
    ]
}

PARTY_FALLBACKS = [
    (re.compile(r"^dc$|democrazia cristiana", re.I), {"display": "DC", "family": "cattolico-popolare", "bloc": "centro", "color": "#2e7d32"}),
    (re.compile(r"^pci$|partito comunista", re.I), {"display": "PCI", "family": "sinistra storica", "bloc": "sinistra", "color": "#c62828"}),
    (re.compile(r"^psi$|socialista", re.I), {"display": "PSI", "family": "sinistra socialista", "bloc": "centro-sinistra", "color": "#ec407a"}),
    (re.compile(r"^msi$|movimento sociale", re.I), {"display": "MSI", "family": "destra nazionale", "bloc": "destra", "color": "#0d47a1"}),
    (re.compile(r"forza italia|^fi$", re.I), {"display": "Forza Italia", "family": "liberal-conservatore", "bloc": "centro-destra", "color": "#1976d2"}),
    (re.compile(r"partito democratico|^pd$", re.I), {"display": "PD", "family": "centro-sinistra", "bloc": "centro-sinistra", "color": "#d32f2f"}),
    (re.compile(r"lega|^ln$", re.I), {"display": "Lega", "family": "regionalista", "bloc": "centro-destra", "color": "#2e7d32"}),
    (re.compile(r"fratelli d.?italia|^fdi$", re.I), {"display": "FdI", "family": "destra nazionale", "bloc": "destra", "color": "#1e3a8a"}),
    (re.compile(r"movimento 5 stelle|^m5s$", re.I), {"display": "M5S", "family": "populista", "bloc": "populista", "color": "#f59e0b"}),
    (re.compile(r"verdi|alleanza verdi|sinistra italiana|avs", re.I), {"display": "AVS / Verdi", "family": "ecologista", "bloc": "sinistra", "color": "#2f855a"}),
    (re.compile(r"azione|italia viva|calenda", re.I), {"display": "Azione / IV", "family": "liberale-riformista", "bloc": "centro", "color": "#fb923c"}),
]

RESULT_LABEL_STOPWORDS = {
    "totale", "totali", "candidate", "candidati", "liste", "lista", "coalizione", "coalizioni",
    "affluenza", "votanti", "elettori", "eletto"
}

PROVINCE_HINTS = [
    (re.compile(r"\(LECCO\)", re.I), "Lecco"),
    (re.compile(r"\(COMO\)", re.I), "Como"),
    (re.compile(r"\(VARESE\)", re.I), "Varese"),
    (re.compile(r"\(BERGAMO\)", re.I), "Bergamo"),
    (re.compile(r"\(BRESCIA\)", re.I), "Brescia"),
    (re.compile(r"\(MILANO\)", re.I), "Milano"),
    (re.compile(r"COLLEGIO[^A-Z]*CANT[UÙ']", re.I), "Como"),
    (re.compile(r"COLLEGIO[^A-Z]*LUINO", re.I), "Varese"),
    (re.compile(r"COLLEGIO[^A-Z]*PONTE SAN PIETRO", re.I), "Bergamo"),
    (re.compile(r"COLLEGIO[^A-Z]*ROMANO DI LOMBARDIA", re.I), "Bergamo"),
    (re.compile(r"COLLEGIO[^A-Z]*DARFO BOARIO TERME", re.I), "Brescia"),
]

BOOTSTRAP_PROVINCE_BY_MUNICIPALITY = {
    "ambivere": "Bergamo",
    "edolo": "Brescia",
    "cunardo": "Varese",
    "berzo demo": "Brescia",
    "ferrera di varese": "Varese",
    "sormano": "Como",
    "fontanella": "Bergamo",
    "olgiate molgora": "Lecco",
}

GEOMETRY_LOOKUP = pd.DataFrame(columns=["normalized_name", "normalized_province", "normalized_region", "geometry_id", "province", "province_code", "region", "region_code"])


def write_json_file(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    path.write_text(fix_text(rendered), encoding="utf-8")


def load_geometry_lookup(reference_root: Path) -> pd.DataFrame:
    path = reference_root / "municipality_geometry_lookup.csv"
    if not path.exists():
        return pd.DataFrame(columns=["normalized_name", "normalized_province", "normalized_region", "geometry_id", "province", "province_code", "region", "region_code"])
    try:
        df = pd.read_csv(path, dtype=str).fillna("")
    except Exception:
        return pd.DataFrame(columns=["normalized_name", "normalized_province", "normalized_region", "geometry_id", "province", "province_code", "region", "region_code"])
    expected = ["normalized_name", "normalized_province", "normalized_region", "geometry_id", "province", "province_code", "region", "region_code"]
    for col in expected:
        if col not in df.columns:
            df[col] = ""
    df["normalized_name"] = df["normalized_name"].map(normalize_token)
    df["normalized_province"] = df["normalized_province"].map(normalize_token)
    df["normalized_region"] = df["normalized_region"].map(normalize_token)
    return df[expected].drop_duplicates(subset=["normalized_name", "normalized_province", "geometry_id"])


def lookup_geometry_record(municipality_name: str, province: str = "") -> Dict[str, str]:
    global GEOMETRY_LOOKUP
    if GEOMETRY_LOOKUP.empty:
        return {"geometry_id": "", "province": province or "", "province_code": ""}
    name_key = normalize_token(municipality_name)
    prov_key = normalize_token(province)
    if not name_key:
        return {"geometry_id": "", "province": province or "", "province_code": ""}
    matches = GEOMETRY_LOOKUP[GEOMETRY_LOOKUP["normalized_name"] == name_key]
    if prov_key:
        exact = matches[matches["normalized_province"] == prov_key]
        if not exact.empty:
            row = exact.iloc[0]
            return {"geometry_id": row.get("geometry_id", ""), "province": row.get("province", province or ""), "province_code": row.get("province_code", ""), "region": row.get("region", ""), "region_code": row.get("region_code", "")}
    if not matches.empty:
        row = matches.iloc[0]
        return {"geometry_id": row.get("geometry_id", ""), "province": row.get("province", province or ""), "province_code": row.get("province_code", ""), "region": row.get("region", ""), "region_code": row.get("region_code", "")}
    return {"geometry_id": "", "province": province or "", "province_code": "", "region": "", "region_code": ""}


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", str(value).lower().strip())
    return value.strip("-")


def safe_float(value) -> Optional[float]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    text = text.replace("%", "").replace(" ", "")
    if text.count(",") and text.count("."):
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        if re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
            text = text.replace(".", "")
    try:
        return float(text)
    except Exception:
        return None


def safe_pct(value, assume_basis_points: bool = False) -> Optional[float]:
    num = safe_float(value)
    if num is None:
        return None
    if assume_basis_points:
        return num / 100 if num > 1 else num
    if num > 100 and num <= 10000:
        return num / 100
    return num


def safe_count(value) -> Optional[int]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    if re.fullmatch(r"-?\d+\.0+", text):
        try:
            return int(round(float(text)))
        except Exception:
            return None
    digits = re.sub(r"\D", "", text)
    if not digits:
        return None
    try:
        return int(digits)
    except Exception:
        return None


def mean(values: List[Optional[float]]) -> Optional[float]:
    vals = [v for v in values if v is not None and not pd.isna(v)]
    return sum(vals) / len(vals) if vals else None


def normalize_token(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def infer_party_meta(label: str) -> Dict[str, str]:
    clean = (label or "").strip()
    for regex, meta in PARTY_FALLBACKS:
        if regex.search(clean):
            return meta
    return {"display": clean or "N/D", "family": "altro", "bloc": "altro", "color": "#64748b"}


def parse_date_from_status(status: Dict[str, object]) -> str:
    dtel = status.get("dtel")
    if not dtel:
        return ""
    try:
        dd, mm, yy = str(dtel).split("/")
        return f"{yy}-{mm}-{dd}"
    except Exception:
        return ""


def sanitize_for_bundle(obj):
    if isinstance(obj, dict):
        return {k: sanitize_for_bundle(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_bundle(v) for v in obj]
    if isinstance(obj, str):
        if re.search(r"([A-Za-z]:\\|/mnt/|/Users/|/home/)", obj):
            if 'normalize_archivio_output.py' in obj or ('python' in obj.lower() and ' ' in obj):
                return '[redacted-path-string]'
            parts = [part for part in re.split(r"[\\/]", obj) if part]
            return parts[-1] if parts else '[redacted-path]'
        return obj
    return obj


def infer_elections(source_root: Path) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    for path in sorted(source_root.glob("camera_*")):
        if not path.is_dir() or path.name.endswith("_clean") or path.name.endswith("_raw"):
            continue
        m = re.search(r"camera_(\d{4})", path.name)
        if not m:
            continue
        year = int(m.group(1))
        status = {}
        status_path = path / "status.json"
        if status_path.exists():
            try:
                status = json.loads(status_path.read_text(encoding="utf-8"))
            except Exception:
                status = {}
        rows.append({
            "election_key": path.name,
            "election_year": year,
            "election_date": parse_date_from_status(status),
            "election_label": f"Camera {year}",
            "electoral_system": "",
            "status": status.get("status", "unknown"),
            "is_complete": "true" if status.get("plausible") is True else "false" if status.get("plausible") is False else "",
            "comparability_notes": sanitize_for_bundle(status.get("warning", "") or status.get("error", "")),
            "source_notes": sanitize_for_bundle(f"strategy={status.get('strategy','')}; trial={status.get('trial_name','')}")
        })
    return sorted(rows, key=lambda d: int(d["election_year"]))


def build_quality_report(source_root: Path) -> Dict[str, object]:
    elections = []
    for path in sorted(source_root.glob("camera_*")):
        if not path.is_dir() or path.name.endswith("_clean") or path.name.endswith("_raw"):
            continue
        status_path = path / "status.json"
        if not status_path.exists():
            continue
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            status = {}
        elections.append(sanitize_for_bundle(status))
    return {"elections": elections}


def ensure_contract_csv(path: Path, headers: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0:
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerow(headers)


def geometry_manifest_files(output_root: Path) -> dict:
    derived = output_root / "data" / "derived"
    geom_dir = derived / "geometries"
    municipality_files: dict[str, str] = {}
    province_files: dict[str, str] = {}
    if geom_dir.exists():
        # Prefer TopoJSON over GeoJSON for the same year (the runtime format),
        # but keep GeoJSON as the fallback when only it is present.
        def _collect(prefix: str, bucket: dict[str, str]) -> None:
            for ext in ('.topojson', '.geojson'):
                for path in sorted(geom_dir.glob(f'{prefix}_*{ext}')):
                    year = path.stem.split('_')[-1]
                    bucket.setdefault(year, str(path.relative_to(output_root)).replace('\\', '/'))
        _collect('municipalities', municipality_files)
        _collect('provinces', province_files)
    if municipality_files:
        latest_year = sorted(municipality_files, key=lambda x: int(x))[-1]
        geometry = municipality_files[latest_year]
        province_geometry = province_files.get(latest_year) if province_files else 'data/derived/lombardia_provinces.geojson'
        geometry_pack = 'data/derived/geometry_pack.json'
    else:
        geometry = 'data/derived/lombardia_municipalities.geojson'
        province_geometry = 'data/derived/lombardia_provinces.geojson'
        geometry_pack = 'data/derived/geometry_pack.json'
    return {
        'geometry': geometry,
        'provinceGeometry': province_geometry,
        'geometryPack': geometry_pack,
        'municipalities': municipality_files,
        'provinces': province_files,
    }


def results_shard_index_path(output_root: Path) -> Path:
    return output_root / "data" / "derived" / "municipality_results_long_by_election.json"


def load_results_shard_index(output_root: Path) -> Dict[str, object]:
    path = results_shard_index_path(output_root)
    if not path.exists():
        return {"generated_by": "preprocess.py", "dataset": "municipality_results_long.csv", "shards": {}, "row_counts": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"generated_by": "preprocess.py", "dataset": "municipality_results_long.csv", "shards": {}, "row_counts": {}}


def write_results_long_shards(output_root: Path, party_rows: pd.DataFrame) -> None:
    derived = output_root / "data" / "derived"
    shard_dir = derived / "results_by_election"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for old in shard_dir.glob("*.csv"):
        old.unlink()

    shards: Dict[str, str] = {}
    row_counts: Dict[str, int] = {}
    if not party_rows.empty and "election_key" in party_rows.columns:
        for election_key, chunk in sorted(party_rows.groupby("election_key"), key=lambda item: str(item[0])):
            filename = f"{slugify(str(election_key))}.csv"
            path = shard_dir / filename
            chunk.to_csv(path, index=False)
            rel = str(path.relative_to(output_root)).replace("\\", "/")
            shards[str(election_key)] = rel
            row_counts[str(election_key)] = int(len(chunk))

    payload = {
        "generated_by": "preprocess.py",
        "dataset": "municipality_results_long.csv",
        "strategy": "by_election",
        "shards": shards,
        "row_counts": row_counts,
    }
    write_json_file(results_shard_index_path(output_root), payload)


def write_geometry_pack(output_root: Path) -> None:
    derived = output_root / 'data' / 'derived'
    info = geometry_manifest_files(output_root)
    pack_path = derived / 'geometry_pack.json'
    municipalities = info['municipalities']
    provinces = info['provinces']
    if not municipalities:
        municipalities = {'2026': info['geometry']}
    if not provinces:
        provinces = {'2026': info['provinceGeometry']}
    payload = {
        'availableYears': sorted({*municipalities.keys(), *provinces.keys()}, key=lambda x: int(x)),
        'municipalities': municipalities,
        'provinces': provinces,
    }
    pack_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')


def write_manifest(output_root: Path) -> None:
    geometry_info = geometry_manifest_files(output_root)
    manifest = {
        "project": {
            "title": "Electio Italia",
            "version": "0.11.1",
            "ready_for_real_data": True,
            "notes": [
                "Vote shares are recomputed from votes whenever a plausible denominator is available.",
                "Derived quality report now includes plausibility validations.",
                "Alias bootstrap and stricter consistency checks are included for demo bundles.",
                "Geometry pack and province overlay are declared in the manifest for reproducible map loading.",
                "Municipality lookup metadata is used when available to enrich province / geometry identifiers.",
                "Guided question cards and evidence ladder are part of the bundle-facing UX layer.",
                "Copy-ready citation and reproducibility lines help make each view shareable and method-aware.",
                "Party results can be delivered both as a monolithic CSV and as per-election shards for faster interactive loading."
            ]
        },
        "files": {
            "electionsMaster": "data/derived/elections_master.csv",
            "municipalitiesMaster": "data/derived/municipalities_master.csv",
            "partiesMaster": "data/derived/parties_master.csv",
            "territorialLineage": "data/derived/territorial_lineage.csv",
            "municipalitySummary": "data/derived/municipality_summary.csv",
            "municipalityResultsLong": "data/derived/municipality_results_long.csv",
            "municipalityResultsLongByElectionIndex": "data/derived/municipality_results_long_by_election.json",
            "municipalityAliases": "data/derived/municipality_aliases.csv",
            "geometry": geometry_info["geometry"],
            "dataQualityReport": "data/derived/data_quality_report.json",
            "customIndicators": "data/derived/custom_indicators.csv",
            "geometryPack": geometry_info["geometryPack"],
            "provinceGeometry": geometry_info["provinceGeometry"],
            "datasetRegistry": "data/derived/dataset_registry.json",
            "codebook": "data/derived/codebook.json",
            "usageNotes": "data/derived/usage_notes.json",
            "updateLog": "data/derived/update_log.json",
            "dataProducts": "data/derived/data_products.json",
            "datasetContracts": "data/derived/dataset_contracts.json",
            "provenance": "data/derived/provenance.json",
            "releaseManifest": "data/derived/release_manifest.json",
            "researchRecipes": "data/derived/research_recipes.json",
            "siteGuides": "data/derived/site_guides.json"
        },
        "contracts": {
            "geometryJoinPriority": ["geometry_id", "municipality_id", "name_current"],
            "territorialModes": ["historical", "harmonized"]
        },
        "loading": {
            "municipalityResultsLong": {
                "strategy": "deferred_by_election",
                "index": "data/derived/municipality_results_long_by_election.json"
            }
        }
    }
    target = output_root / "data" / "derived"
    target.mkdir(parents=True, exist_ok=True)
    write_json_file(target / "manifest.json", manifest)



def build_dataset_registry(output_root: Path, elections: List[Dict[str, object]], summary_rows: pd.DataFrame, party_rows: pd.DataFrame, quality: Dict[str, object]) -> Dict[str, object]:
    derived = output_root / "data" / "derived"
    geometry_info = geometry_manifest_files(output_root)
    shard_index = load_results_shard_index(output_root)
    shard_paths = {str(k): str(v) for k, v in (shard_index.get("shards") or {}).items()}
    rows = []
    for election in elections:
        key = election.get("election_key")
        summary_n = int(len(summary_rows[summary_rows.get("election_key") == key])) if not summary_rows.empty and "election_key" in summary_rows else 0
        result_n = int(len(party_rows[party_rows.get("election_key") == key])) if not party_rows.empty and "election_key" in party_rows else 0
        dataset_family = "assemblea_costituente_municipality_historical" if str(key).startswith("assemblea_costituente_") else "camera_municipality_historical"
        rows.append({
            "dataset_key": key,
            "dataset_family": dataset_family,
            "election_key": key,
            "election_year": election.get("election_year"),
            "summary_rows": summary_n,
            "result_rows": result_n,
            "territorial_mode": "historical",
            "boundary_basis": "auto",
            "status": "usable" if (summary_n or result_n) else "empty",
            "coverage_label": "summary+results" if (summary_n and result_n) else "summary_only" if summary_n else "results_only" if result_n else "empty",
            "download_summary": "data/derived/municipality_summary.csv",
            "download_results": shard_paths.get(str(key), "data/derived/municipality_results_long.csv")
        })
    for year, path in (geometry_info.get('municipalities') or {}).items():
        rows.append({
            "dataset_key": f"geometry_municipalities_{year}",
            "dataset_family": "geometry_boundary",
            "boundary_basis": year,
            "status": "usable",
            "coverage_label": "geometry",
            "download_geometry": path
        })
    return {
        "generated_by": "preprocess.py",
        "project": "Electio Italia",
        "datasets": rows,
        "summary": {
            "technical_readiness": quality.get("derived_validations", {}).get("technical_readiness_score"),
            "substantive_readiness": quality.get("derived_validations", {}).get("substantive_coverage_score")
        }
    }


def build_codebook_payload() -> Dict[str, object]:
    descriptions = {
        "election_key": "Chiave stabile dell'elezione.",
        "election_year": "Anno dell'elezione.",
        "election_date": "Data ISO dell'elezione, se disponibile.",
        "municipality_id": "Codice comune stabile/normalizzato usato nel bundle.",
        "municipality_name": "Nome del comune osservato nel record.",
        "province": "Provincia del record/territorio osservato.",
        "geometry_id": "Chiave di join geografico verso le geometrie comunali.",
        "territorial_mode": "historical o harmonized.",
        "turnout_pct": "Affluenza percentuale.",
        "electors": "Elettori iscritti, se disponibili.",
        "voters": "Votanti, se disponibili.",
        "valid_votes": "Voti validi, se disponibili.",
        "first_party_std": "Leader della competizione dopo standardizzazione partiti.",
        "vote_share": "Quota percentuale ricalcolata dai voti quando possibile.",
        "party_std": "Nome standardizzato del partito/lista.",
        "party_family": "Famiglia politica comparabile.",
        "bloc": "Blocco ideologico aggregato.",
        "comparability_note": "Note metodologiche e fallback applicati al record.",
        "completeness_flag": "Flag sintetico di completezza/qualità del record."
    }
    datasets = []
    for filename, columns in CONTRACTS.items():
        datasets.append({
            "dataset": filename,
            "columns": [{
                "name": col,
                "description": descriptions.get(col, "Campo del contratto dati del bundle."),
                "type_hint": "number" if any(tok in col for tok in ["pct", "votes", "year", "share", "margin"]) else "string"
            } for col in columns]
        })
    return {"generated_by": "preprocess.py", "datasets": datasets}


def build_usage_notes_payload(quality: Dict[str, object], geometry_info: Dict[str, object]) -> Dict[str, object]:
    derived = quality.get("derived_validations", {})
    notes = [
        {"key": "historical_mode", "title": "Modalità storica", "severity": "info", "text": "Nel bundle corrente la modalità storica è la base osservata. La modalità armonizzata va esposta solo se il bundle contiene righe harmonized vere."},
        {"key": "geometry_basis", "title": "Base geometrica", "severity": "info", "text": f"Geometrie comunali disponibili per gli anni: {', '.join(sorted((geometry_info.get('municipalities') or {}).keys(), key=int)) or 'nessuno'}. Se scegli una base geometrica esplicita, stai cambiando la rappresentazione cartografica, non il dato elettorale sottostante."},
        {"key": "coverage", "title": "Copertura sostanziale", "severity": "warn" if (derived.get('substantive_coverage_score') or 0) < 50 else "info", "text": f"La readiness tecnica può essere alta anche con copertura sostanziale bassa. Bundle attuale: technical={derived.get('technical_readiness_score')}, substantive={derived.get('substantive_coverage_score')}."},
        {"key": "shares", "title": "Quote di partito", "severity": "info", "text": "Le quote sono ricalcolate dai voti quando il denominatore è plausibile. Se i risultati di partito sono incompleti, le quote vanno lette come parziali e non come distribuzione esaustiva."},
        {"key": "province_region", "title": "Contesto provinciale e regionale", "severity": "info", "text": "I confronti con provincia e Italia sono calcolati come aggregati pesati sui conteggi disponibili, non come media semplice dei comuni."}
    ]
    return {"generated_by": "preprocess.py", "notes": notes}


def build_data_products_payload() -> Dict[str, object]:
    return {
        "generated_by": "preprocess.py",
        "release_channel": "static_bundle",
        "products": [
            {
                "product_key": "camera_muni_historical",
                "title": "Camera e Costituente Italia - comuni storici",
                "kind": "election_panel",
                "territorial_mode": "historical",
                "granularity": "municipality-election",
                "primary_dataset_key": "municipalitySummary",
                "companion_dataset_key": "municipalityResultsLong",
                "delivery_strategy": "monolith_plus_election_shards",
                "join_keys": ["municipality_id", "geometry_id", "election_key"],
                "guardrails": [
                    "Usare coverage e completeness_flag prima di interpretare trend forti.",
                    "Le quote di partito possono restare parziali nei bundle incompleti."
                ]
            },
            {
                "product_key": "geometry_pack_italy",
                "title": "Pacchetto geometrie Italia",
                "kind": "boundary_pack",
                "granularity": "municipality/province boundary by year",
                "primary_dataset_key": "geometryPack",
                "companion_dataset_key": "provinceGeometry",
                "join_keys": ["geometry_id", "municipality_id"]
            },
            {
                "product_key": "metadata_layer",
                "title": "Metadata layer del bundle",
                "kind": "metadata_bundle",
                "granularity": "bundle-level",
                "primary_dataset_key": "datasetRegistry",
                "companion_dataset_key": "codebook",
                "extra_dataset_keys": ["usageNotes", "updateLog"]
            }
        ],
        "clients": [
            {
                "client_key": "python_loader",
                "language": "python",
                "entrypoint": "clients/python/lce_loader.py",
                "example": "from clients.python.lce_loader import load_bundle\nbundle = load_bundle('.')\nsummary = bundle.load_dataset('municipalitySummary')"
            },
            {
                "client_key": "r_loader",
                "language": "r",
                "entrypoint": "clients/r/lce_loader.R",
                "example": "source('clients/r/lce_loader.R')\nbundle <- load_lce_bundle('.')\nsummary <- lce_read(bundle, 'municipalitySummary')"
            }
        ]
    }




def _kind_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return "csv"
    if suffix in {".json", ".geojson"}:
        return suffix.lstrip('.')
    return suffix.lstrip('.') or "file"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def summarize_file(path: Path) -> Dict[str, object]:
    info = {
        "path": str(path).replace('\\', '/'),
        "kind": _kind_for_path(path),
        "size_bytes": path.stat().st_size if path.exists() else 0,
        "sha256": sha256_file(path) if path.exists() else "",
    }
    if not path.exists():
        return info
    if path.suffix.lower() == '.csv':
        try:
            with path.open(encoding='utf-8', newline='') as fh:
                rows = list(csv.DictReader(fh))
            info["row_count"] = len(rows)
            info["columns"] = list(rows[0].keys()) if rows else []
        except Exception:
            info["row_count"] = 0
            info["columns"] = []
    elif path.suffix.lower() in {'.json', '.geojson'}:
        try:
            obj = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(obj, dict):
                if isinstance(obj.get('features'), list):
                    info["feature_count"] = len(obj.get('features') or [])
                elif isinstance(obj.get('datasets'), list):
                    info["dataset_count"] = len(obj.get('datasets') or [])
                elif isinstance(obj.get('products'), list):
                    info["product_count"] = len(obj.get('products') or [])
        except Exception:
            pass
    return info


def build_dataset_contracts_payload() -> Dict[str, object]:
    key_hints = {
        "municipality_summary.csv": ["election_key", "municipality_id", "territorial_mode"],
        "municipality_results_long.csv": ["election_key", "municipality_id", "party_std", "territorial_mode"],
        "municipalities_master.csv": ["municipality_id"],
        "parties_master.csv": ["party_std"],
        "territorial_lineage.csv": ["municipality_id_stable"],
        "municipality_aliases.csv": ["municipality_id", "alias"],
        "custom_indicators.csv": ["indicator_key", "municipality_id", "election_key", "territorial_mode"],
    }
    validations = {
        "municipality_summary.csv": [
            "completeness_flag deve distinguere turnout_only da party_results_checked",
            "turnout_pct deve restare tra 0 e 100 quando disponibile",
            "geometry_id va usato come chiave primaria di join geografico quando disponibile"
        ],
        "municipality_results_long.csv": [
            "vote_share deve restare in [0,100] salvo arrotondamenti minimi",
            "party_std deve essere la forma standardizzata confrontabile",
            "comparability_note deve esplicitare fallback e parzialità"
        ],
        "municipality_aliases.csv": [
            "alias_type è richiesto",
            "gli alias servono per ricerca e lineage, non come identificatore stabile"
        ]
    }
    contracts = []
    for filename, columns in CONTRACTS.items():
        contracts.append({
            "dataset": filename,
            "required_columns": columns,
            "key_columns": key_hints.get(filename, columns[:1]),
            "validation_rules": validations.get(filename, ["rispettare lo schema dichiarato nel contratto bundle"]),
        })
    return {"generated_by": "preprocess.py", "contracts": contracts}


def build_provenance_payload(output_root: Path) -> Dict[str, object]:
    files = json.loads((output_root / 'data' / 'derived' / 'manifest.json').read_text(encoding='utf-8')).get('files', {}) if (output_root / 'data' / 'derived' / 'manifest.json').exists() else {}
    entries = []
    generic_steps = [
        "ingest da cartelle camera_YYYY e layout clean/raw/validated quando presenti",
        "normalizzazione di comuni, province, partiti e join geometry-aware",
        "scrittura di dataset derived, metadata layer e manifest machine-readable",
        "derivazione opzionale dei risultati di partito anche come shard per elezione"
    ]
    for key, rel in files.items():
        entries.append({
            "dataset_key": key,
            "path": rel,
            "produced_by": "scripts/preprocess.py" if key not in {"geometry", "provinceGeometry", "geometryPack"} else "scripts/preprocess.py + pack geometrico presente nel bundle",
            "source_class": "derived_bundle",
            "transformation_steps": generic_steps if key not in {"geometry", "provinceGeometry", "geometryPack"} else [
                "integrazione di geometrie comunali/provinciali nel bundle",
                "selezione anno base e fallback dichiarati nel geometry pack"
            ],
            "limitations": [
                "la provenance del bundle non sostituisce le fonti elettorali originali",
                "la copertura sostanziale dipende dai dati effettivamente ingestiti"
            ]
        })
    return {"generated_by": "preprocess.py", "entries": entries}


def build_release_manifest(output_root: Path) -> Dict[str, object]:
    manifest_path = output_root / 'data' / 'derived' / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {"files": {}, "project": {}}
    files = manifest.get('files', {})
    file_entries = {}
    for key, rel in files.items():
        if key == "releaseManifest":
            continue
        file_entries[key] = summarize_file(output_root / rel)
    return {
        "generated_by": "preprocess.py",
        "project": manifest.get('project') or {},
        "bundle_root": ".",
        "file_entries": file_entries,
        "integrity": {
            "sha256_scope": sorted(file_entries.keys()),
            "all_declared_files_present": all((output_root / rel).exists() for key, rel in files.items() if key != "releaseManifest")
        }
    }
def build_update_log_payload() -> Dict[str, object]:
    return {"generated_by": "preprocess.py", "entries": [
        {"version": "v31", "date": "2026-04-05", "title": "Front door più forte, site guides e FAQ rapido", "changes": [
            "Aggiunti site guides machine-readable con layers, explainers e FAQ.",
            "Nuove sezioni frontali: tre livelli d'uso, metodo in 90 secondi e FAQ rapido.",
            "Release studio reso visibile e integrato nella facciata pubblica della app."
        ]},
        {"version": "v30", "date": "2026-04-04", "title": "Hero pubblico, release studio e research recipes", "changes": [
            "Aggiunte hero section, pathway cards e release studio come facciata più forte sopra il motore dati.",
            "Introdotto research_recipes.json come guida machine-readable per percorsi pubblici e research-safe.",
            "Loader Python esteso con recipes, citation e filtri summary; check bundle più severo sui nuovi strati."
        ]},
        {"version": "v29", "date": "2026-04-04", "title": "Release identity, provenance e dataset contracts", "changes": [
            "Aggiunti release_manifest.json, provenance.json e dataset_contracts.json come strati machine-readable del bundle.",
            "Loader Python rafforzato con verifica integrità e listing dei prodotti dati.",
            "Controlli bundle più severi su release identity, checksums, contratti dati e test del loader."
        ]},
        {"version": "v28", "date": "2026-04-04", "title": "Data products, loader ufficiali e release discipline", "changes": [
            "Aggiunto data_products.json come strato machine-readable sopra manifest e dataset registry.",
            "Aggiunti loader ufficiali Python e R per usare il bundle anche fuori dal browser.",
            "Rafforzati i controlli bundle su data products, client loader e allineamento release."
        ]},
        {"version": "v27", "date": "2026-04-04", "title": "Domande guidate, evidenza e citabilità", "changes": [
            "Aggiunto pannello di domande guidate audience-aware con percorsi one-click.",
            "Aggiunto pannello livello di evidenza con citazione pronta della vista e riga minima di riproducibilità.",
            "Estratti audience modes, glossario e question bank in modules/guidance.js."
        ]},
        {"version": "0.8.0", "date": "2026-04-04", "title": "GERDA-style data layer", "changes": [
            "Aggiunti dataset registry, codebook, usage notes e update log nel bundle.",
            "Manifest allineato a un catalogo dati più esplicito e machine-readable.",
            "Supporto a base geometrica selezionabile lato frontend."
        ]},
        {"version": "0.7.2", "date": "2026-04-04", "title": "Local bundle loader", "changes": [
            "Caricamento di bundle locali dal browser.",
            "Catalogo dati e coverage matrix nel frontend."
        ]}
    ]}


def build_research_recipes_payload() -> Dict[str, object]:
    return {
        "generated_by": "preprocess.py",
        "recipes": [
            {
                "recipe_key": "public_overview",
                "title": "Panoramica pubblica del territorio",
                "audiences": ["public", "press", "admin"],
                "goal": "Aprire il bundle da una vista civica chiara senza perdere coverage e metodo.",
                "jump_target": "map-wrapper",
                "settings": {"analysisMode": "explore", "metric": "turnout", "palette": "sequential"},
                "steps": ["Parti da affluenza e coverage.", "Apri scheda comune e overview.", "Passa ai partiti solo dopo aver letto briefing ed evidenza."],
                "guardrails": ["No-data non equivale a valore basso.", "Coverage e comparabilità vanno dichiarati prima delle conclusioni."]
            },
            {
                "recipe_key": "bundle_audit",
                "title": "Audit bundle e accesso programmatico",
                "audiences": ["research", "admin", "press"],
                "goal": "Usare il progetto anche come release verificabile e caricabile da codice.",
                "jump_target": "release-studio-panel",
                "settings": {"analysisMode": "diagnose", "metric": "stability_index", "palette": "accessible", "showNotes": True},
                "steps": ["Controlla release, provenance e contracts.", "Apri loader e snippets Python/R.", "Usa audit, codebook e dataset registry insieme."],
                "guardrails": ["Integrità tecnica e copertura sostanziale non coincidono."]
            }
        ]
    }


def build_default_site_guides_payload() -> Dict[str, object]:
    return {
        "generated_by": "preprocess.py",
        "layers": [
            {
                "key": "explore",
                "title": "Esplora",
                "eyebrow": "Ingresso pubblico",
                "description": "Apri la mappa, leggi affluenza, partiti e profilo comunale senza perdere coverage e contesto.",
                "audience": "public",
                "analysisMode": "explore",
                "uiLevel": "basic",
                "jumpTarget": "map-wrapper",
                "cta": "Apri la mappa"
            },
            {
                "key": "understand",
                "title": "Capisci",
                "eyebrow": "Layer briefing",
                "description": "Passa da mappa a sintesi, evidenza e confronto per amministratori, stampa e uso civico disciplinato.",
                "audience": "press",
                "analysisMode": "compare",
                "uiLevel": "basic",
                "jumpTarget": "evidence-panel",
                "cta": "Apri briefing"
            },
            {
                "key": "analyze",
                "title": "Analizza",
                "eyebrow": "Layer ricerca",
                "description": "Vai su audit, coverage, release, accesso programmatico e prodotti dati quando la vista deve essere riproducibile.",
                "audience": "research",
                "analysisMode": "diagnose",
                "uiLevel": "advanced",
                "jumpTarget": "release-studio-panel",
                "cta": "Apri release studio"
            }
        ],
        "explainers": [
            {
                "key": "what_you_see",
                "title": "Cosa stai guardando",
                "body": "Ogni vista combina metrica, elezione, modalita territoriale e base geometrica. La mappa non e mai neutra: e sempre un filtro dichiarato.",
                "accent": "scope"
            },
            {
                "key": "nodata",
                "title": "No data non vuol dire valore basso",
                "body": "Un comune non colorato puo indicare dato assente, join territoriale incompleto o coverage insufficiente. Va distinto da un risultato minimo.",
                "accent": "nodata"
            },
            {
                "key": "historical_vs_harm",
                "title": "Storico vs armonizzato",
                "body": "Storico segue il territorio com'era nell'elezione; armonizzato riallinea i risultati a un perimetro comune. Le due letture rispondono a domande diverse.",
                "accent": "boundary"
            },
            {
                "key": "cite",
                "title": "Quando una vista e citabile",
                "body": "Coverage, risultati, geometrie e confronto devono essere dichiarati. Per questo il sito espone evidenza, citazione pronta e riga minima di riproducibilita.",
                "accent": "evidence"
            }
        ],
        "faq": [
            {
                "question": "Posso confrontare due elezioni qualsiasi?",
                "answer": "Solo se gli anni hanno copertura utile e la base territoriale scelta regge davvero la lettura. Evidence ladder e coverage matrix servono proprio a questo.",
                "tag": "Confronti"
            },
            {
                "question": "Che cosa significa no data?",
                "answer": "Significa che il bundle non offre un valore affidabile per quella vista: dato assente, troppo parziale o non agganciato bene alla geometria.",
                "tag": "No data"
            },
            {
                "question": "Qual e la differenza tra storico e armonizzato?",
                "answer": "Storico conserva il perimetro dell'epoca; armonizzato prova a riallineare i risultati su confini costanti. Uno privilegia fedelta storica, l'altro comparabilita.",
                "tag": "Boundary"
            },
            {
                "question": "Posso citare una vista in un report?",
                "answer": "Si, ma conviene sempre citare metrica, anno, modalita territoriale, base geometrica e livello di evidenza.",
                "tag": "Citazione"
            }
        ],
        "manifesto": {
            "title": "Una base elettorale che non ti chiede di scegliere tra rigore e accessibilita.",
            "standfirst": "Sotto c'e una release leggibile da codice; sopra, un sito che prova a spiegare, confrontare e dichiarare i limiti senza nasconderli.",
            "statement": "Non una mappa che suggerisce una storia sola, ma un atlante che lascia emergere storie diverse sullo stesso terreno dichiarato."
        },
        "pillars": [
            {
                "key": "same_engine",
                "eyebrow": "Stesso motore",
                "title": "Pubblico, briefing e ricerca",
                "body": "Tre porte di ingresso, una sola base dati: puoi partire semplice e scendere fino a release, contracts e accesso programmatico."
            },
            {
                "key": "declared_limits",
                "eyebrow": "Limiti dichiarati",
                "title": "No-data e coverage non vengono nascosti",
                "body": "La parte divulgativa non finge completezza: rende leggibili coverage, evidenza e guardrail invece di trasformare il vuoto in storytelling."
            },
            {
                "key": "release_backed",
                "eyebrow": "Release-backed",
                "title": "Ogni vista vive dentro una release",
                "body": "Manifest, products, provenance, contracts, citation e loader spostano il progetto da dashboard gradevole a oggetto archivistico."
            },
            {
                "key": "boundary_aware",
                "eyebrow": "Boundary-aware",
                "title": "I confini fanno parte della lettura",
                "body": "Storico, armonizzato e basi geometriche non sono dettagli nascosti: sono parte della promessa metodologica e della UX."
            }
        ]
    }


def load_or_default_site_guides(output_root: Path) -> Dict[str, object]:
    path = output_root / "data" / "derived" / "site_guides.json"
    if path.exists():
        try:
            return json.loads(fix_text(path.read_text(encoding="utf-8")))
        except Exception:
            pass
    return build_default_site_guides_payload()

def normalize_municipality_name(raw: str) -> str:
    if raw is None:
        return ""
    raw = re.sub(r"\s+", " ", str(raw)).strip()
    if not raw or raw.lower() == "nan":
        return ""
    m = re.search(r"Comune\s+(.+)$", raw, flags=re.I)
    if m:
        return m.group(1).strip().title()
    return ""


def extract_province(text: str, municipality_name: str = "") -> str:
    text = text or ""
    m = re.search(r"Provincia\s+([A-ZÀ-Ü'\- ]+)", text)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip().title()
    m = re.search(r"\(([A-ZÀ-Ü'\- ]+)\)\s*Comune", text)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip().title()
    for regex, province in PROVINCE_HINTS:
        if regex.search(text):
            return province
    norm_name = normalize_token(municipality_name)
    if norm_name in BOOTSTRAP_PROVINCE_BY_MUNICIPALITY:
        return BOOTSTRAP_PROVINCE_BY_MUNICIPALITY[norm_name]
    return ""


def municipality_code_from_url(url: str) -> str:
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    for key in ["lev4", "lev3", "ne4", "ne3"]:
        value = params.get(key, [None])[0]
        if value and value != "0":
            return str(value).split("-")[0]
    return ""


def build_metadata_map(raw_entities_path: Optional[Path]) -> pd.DataFrame:
    metadata_columns = ["url", "municipality_name", "province", "province_code", "municipality_code", "municipality_id", "geometry_id"]
    if not raw_entities_path or not raw_entities_path.exists():
        return pd.DataFrame(columns=metadata_columns)
    try:
        df = pd.read_csv(raw_entities_path)
    except Exception:
        return pd.DataFrame(columns=metadata_columns)
    if df.empty:
        return pd.DataFrame(columns=metadata_columns)
    names, provinces, codes = [], [], []
    for _, row in df.iterrows():
        combined = " ".join([
            str(row.get("title") or ""),
            str(row.get("municipality_name") or ""),
            str(row.get("heading_1") or ""),
            str(row.get("heading_2") or ""),
            str(row.get("text_excerpt") or "")
        ]).strip()
        name = normalize_municipality_name(row.get("municipality_name")) or normalize_municipality_name(row.get("heading_2")) or normalize_municipality_name(row.get("title"))
        province = extract_province(combined, name)
        code = municipality_code_from_url(str(row.get("url") or ""))
        names.append(name)
        provinces.append(province)
        codes.append(code)
    out = pd.DataFrame({
        "url": df.get("url", pd.Series(dtype=str)),
        "municipality_name": names,
        "province": provinces,
        "municipality_code": codes,
    })
    out = out[out["municipality_name"].astype(str).str.strip() != ""].copy()
    if out.empty:
        return pd.DataFrame(columns=metadata_columns)
    enrichment = out.apply(lambda r: pd.Series(lookup_geometry_record(r.get("municipality_name", ""), r.get("province", ""))), axis=1)
    if isinstance(enrichment, pd.Series):
        enrichment = pd.DataFrame(list(enrichment), index=out.index)
    enrichment = enrichment.reindex(columns=["geometry_id", "province", "province_code"], fill_value="")
    out["province"] = out.apply(lambda r: r["province"] if str(r["province"] or "").strip() else enrichment.loc[r.name, "province"], axis=1)
    out["province_code"] = enrichment["province_code"]
    out["geometry_id"] = enrichment["geometry_id"]
    out["municipality_id"] = out.apply(lambda r: r["municipality_code"] if str(r["municipality_code"]).strip() else (r["geometry_id"] if str(r["geometry_id"]).strip() else slugify(r["municipality_name"])), axis=1)
    out["geometry_id"] = out.apply(lambda r: r["geometry_id"] if str(r["geometry_id"] or "").strip() else r["municipality_id"], axis=1)
    return out.drop_duplicates(subset=["url"])


def choose_party_label(row: pd.Series, text_cols: List[str]) -> Optional[str]:
    values = [(col, str(row.get(col) or "").strip()) for col in text_cols]
    values = [(col, val) for col, val in values if val and val.lower() != "nan" and normalize_token(val) not in RESULT_LABEL_STOPWORDS]
    if not values:
        return None
    last_label = values[-1][1]
    first_label = values[0][1]
    if re.fullmatch(r"[0-9.,]+", last_label):
        return None
    if len(values) >= 2 and last_label != first_label:
        return last_label
    if re.search(r"partito|lista|movimento|lega|forza|italia|fratelli|verdi|sinistra|democra|social|popolare|liber|unione|alleanza|radical|udc|pri|pli|psdi|pci|psi|dc|msi|m5s|europa|potere|casapound", last_label, re.I):
        return last_label
    if re.fullmatch(r"[A-Z]{2,8}", last_label):
        return last_label
    return None


def parse_invalid_vote_totals(tables_path: Path) -> pd.DataFrame:
    columns = ["url", "invalid_votes_total", "blank_votes"]
    if not tables_path.exists():
        return pd.DataFrame(columns=columns)
    raw = pd.read_csv(tables_path, dtype=str)
    if raw.empty:
        return pd.DataFrame(columns=columns)
    out = []
    for url, group in raw.groupby("__url", dropna=False):
        invalid_total = None
        blank_votes = None
        for _, table in group.groupby("__table_idx", dropna=False):
            try:
                pivot = table.pivot(index="__rownum", columns="column_name", values="cell_value")
            except Exception:
                continue
            string_rows = [
                " ".join(str(v) for v in row.tolist() if str(v).strip() and str(v).lower() != "nan")
                for _, row in pivot.iterrows()
            ]
            for text in string_rows:
                low = normalize_token(text)
                if "non valide" in low:
                    invalid_total = safe_count(text)
                elif "bianche" in low and blank_votes is None:
                    blank_votes = safe_count(text)
        out.append({"url": url, "invalid_votes_total": invalid_total, "blank_votes": blank_votes})
    return pd.DataFrame(out)


def parse_turnout_rows(clean_dir: Path, meta_by_url: pd.DataFrame, election_meta: Dict[str, object]) -> pd.DataFrame:
    columns = [
        "election_key","election_year","election_date","municipality_id","municipality_name","province","region","geometry_id",
        "territorial_mode","territorial_status","turnout_pct","electors","voters","valid_votes","total_votes","comparability_note","completeness_flag"
    ]
    turnout_path = clean_dir / "turnout.csv"
    if not turnout_path.exists():
        return pd.DataFrame(columns=columns)
    turnout = pd.read_csv(turnout_path, dtype=str)
    turnout = turnout.merge(meta_by_url, on="url", how="left")
    turnout = turnout.merge(parse_invalid_vote_totals(clean_dir / "tables_long.csv"), on="url", how="left")
    turnout = turnout[turnout["municipality_name"].fillna("").astype(str).str.strip() != ""]
    if turnout.empty:
        return pd.DataFrame(columns=columns)

    turnout["turnout_pct"] = turnout["percentuale_votanti"].apply(safe_pct)
    turnout["electors"] = turnout["elettori"].apply(safe_count)
    turnout["voters"] = turnout["votanti"].apply(safe_count)
    turnout["total_votes"] = turnout["voters"]

    def corrected_counts(row: pd.Series) -> Tuple[Optional[int], Optional[int]]:
        electors = row["electors"]
        voters = row["voters"]
        turnout_pct = row["turnout_pct"]
        if turnout_pct and turnout_pct > 0:
            estimated_electors = round((voters / (turnout_pct / 100))) if voters else None
            estimated_voters = round((electors * turnout_pct / 100)) if electors else None
            if voters and (electors is None or electors < voters):
                electors = estimated_electors
            if electors and voters is None:
                voters = estimated_voters
        return electors, voters

    turnout[["electors", "voters"]] = turnout.apply(lambda r: pd.Series(corrected_counts(r)), axis=1)
    turnout["invalid_votes_total"] = turnout["invalid_votes_total"].apply(safe_count)
    turnout["blank_votes"] = turnout["blank_votes"].apply(safe_count)
    turnout["invalid_votes_total"] = turnout.apply(
        lambda r: r["invalid_votes_total"] if pd.notna(r["invalid_votes_total"]) else ((safe_count(r.get("schede_contestate")) or 0) + (safe_count(r.get("schede_nulle")) or 0) + (safe_count(r.get("schede_bianche")) or 0)) or None,
        axis=1,
    )
    turnout["valid_votes"] = turnout.apply(
        lambda r: (int(r["voters"] - r["invalid_votes_total"]) if pd.notna(r["voters"]) and pd.notna(r["invalid_votes_total"]) and r["voters"] >= r["invalid_votes_total"] else None),
        axis=1,
    )
    turnout["completeness_flag"] = turnout.apply(lambda r: "clean_ingest_checked" if pd.notna(r["turnout_pct"]) and pd.notna(r["voters"]) else "partial_clean_ingest", axis=1)
    turnout["comparability_note"] = turnout.apply(lambda r: "turnout_from_clean|counts_corrected_from_turnout" if pd.notna(r["turnout_pct"]) and pd.notna(r["electors"]) and pd.notna(r["voters"]) else "turnout_from_clean", axis=1)
    turnout["territorial_mode"] = "historical"
    turnout["territorial_status"] = "observed"
    turnout["region"] = "Lombardia"
    turnout["geometry_id"] = turnout.apply(lambda r: r["geometry_id"] if str(r.get("geometry_id") or "").strip() else r["municipality_id"], axis=1)
    turnout["election_key"] = election_meta["election_key"]
    turnout["election_year"] = election_meta["election_year"]
    turnout["election_date"] = election_meta["election_date"]
    return turnout[columns].drop_duplicates(subset=["election_key", "municipality_id"])


def parse_party_rows(clean_dir: Path, meta_by_url: pd.DataFrame, election_meta: Dict[str, object]) -> pd.DataFrame:
    tables_path = clean_dir / "tables_long.csv"
    if not tables_path.exists():
        return pd.DataFrame(columns=CONTRACTS["municipality_results_long.csv"] + ["vote_share_raw"])
    raw = pd.read_csv(tables_path, dtype=str)
    if raw.empty:
        return pd.DataFrame(columns=CONTRACTS["municipality_results_long.csv"] + ["vote_share_raw"])
    merged = raw.merge(meta_by_url, left_on="__url", right_on="url", how="left")
    out_rows: List[Dict[str, object]] = []
    for (_, _), group in merged.groupby(["__url", "__table_idx"], dropna=False):
        try:
            pivot = group.pivot(index="__rownum", columns="column_name", values="cell_value")
        except Exception:
            continue
        vote_candidates = [c for c in pivot.columns if normalize_token(c).startswith("voti")]
        pct_candidates = [c for c in pivot.columns if "%" in str(c)]
        if not vote_candidates and not pct_candidates:
            continue
        vote_col = vote_candidates[0] if vote_candidates else None
        pct_col = pct_candidates[0] if pct_candidates else None
        text_cols = [c for c in pivot.columns if c not in {vote_col, pct_col} and not str(c).startswith("Unnamed")]
        municipality_name = group["municipality_name"].dropna().astype(str).iloc[0] if group["municipality_name"].notna().any() else ""
        if not municipality_name:
            continue
        province = group["province"].dropna().astype(str).iloc[0] if group["province"].notna().any() else ""
        geometry_id = group["geometry_id"].dropna().astype(str).iloc[0] if group.get("geometry_id") is not None and group["geometry_id"].notna().any() else ""
        municipality_id = group["municipality_id"].dropna().astype(str).iloc[0] if group["municipality_id"].notna().any() else (geometry_id or slugify(municipality_name))
        if not province or not geometry_id:
            geo = lookup_geometry_record(municipality_name, province)
            province = province or geo.get("province", "")
            geometry_id = geometry_id or geo.get("geometry_id", "")
        for _, row in pivot.iterrows():
            label = choose_party_label(row, text_cols)
            if not label or normalize_token(label) in RESULT_LABEL_STOPWORDS:
                continue
            votes = safe_count(row.get(vote_col)) if vote_col else None
            vote_share_raw = safe_pct(row.get(pct_col), assume_basis_points=True) if pct_col else None
            if votes is None and vote_share_raw is None:
                continue
            meta = infer_party_meta(label)
            out_rows.append({
                "election_key": election_meta["election_key"],
                "election_year": election_meta["election_year"],
                "election_date": election_meta["election_date"],
                "municipality_id": municipality_id,
                "municipality_name": municipality_name,
                "province": province,
                "region": "Lombardia",
                "party_raw": label,
                "party_std": meta["display"],
                "party_family": meta["family"],
                "bloc": meta["bloc"],
                "votes": votes,
                "votes_raw_text": row.get(vote_col) if vote_col else None,
                "vote_share_raw": vote_share_raw,
                "rank": None,
                "territorial_mode": "historical",
                "territorial_status": "observed",
                "geometry_id": geometry_id or municipality_id,
                "comparability_note": "heuristic_party_parse"
            })
    out = pd.DataFrame(out_rows)
    if out.empty:
        return pd.DataFrame(columns=CONTRACTS["municipality_results_long.csv"] + ["vote_share_raw"])
    dedup_cols = [
        "election_key","municipality_id","party_raw","party_std","votes","votes_raw_text","vote_share_raw","territorial_mode","geometry_id"
    ]
    out = out.drop_duplicates(subset=dedup_cols)
    grouped = out.groupby([
        "election_key","election_year","election_date","municipality_id","municipality_name","province","region",
        "party_raw","party_std","party_family","bloc","territorial_mode","territorial_status","geometry_id"
    ], as_index=False).agg({"votes": "sum", "votes_raw_text": "first", "vote_share_raw": "mean", "comparability_note": "first"})
    grouped["vote_share"] = grouped["vote_share_raw"]
    return grouped


def normalize_party_rows(turnout_rows: pd.DataFrame, party_rows: pd.DataFrame) -> pd.DataFrame:
    if party_rows.empty:
        return pd.DataFrame(columns=CONTRACTS["municipality_results_long.csv"])
    base = party_rows.copy()
    turnout_denoms = turnout_rows[["election_key", "municipality_id", "valid_votes", "voters"]].drop_duplicates()
    base = base.merge(turnout_denoms, on=["election_key", "municipality_id"], how="left")

    def choose_denominator(row: pd.Series) -> Tuple[Optional[float], str]:
        valid_votes = row.get("valid_votes")
        voters = row.get("voters")
        sum_party_votes = row.get("sum_party_votes")
        if pd.notna(valid_votes) and valid_votes > 0 and pd.notna(sum_party_votes):
            if sum_party_votes <= valid_votes * 1.05 and sum_party_votes >= valid_votes * 0.5:
                return float(valid_votes), "share_recomputed_from_valid_votes"
        if pd.notna(sum_party_votes) and sum_party_votes > 0:
            return float(sum_party_votes), "share_recomputed_from_party_sum"
        if pd.notna(voters) and voters > 0 and pd.notna(row.get("vote_share_raw")):
            return float(voters), "share_fallback_on_voters"
        return None, "share_raw_fallback"

    denoms = base.apply(lambda r: choose_denominator(r), axis=1)
    base["share_denominator"] = [d[0] for d in denoms]
    base["share_method"] = [d[1] for d in denoms]
    def adjusted_votes(row: pd.Series):
        votes = row.get("votes")
        denom = row.get("share_denominator")
        raw_share = row.get("vote_share_raw")
        if pd.isna(votes):
            return votes
        if pd.notna(denom) and denom > 0 and pd.notna(raw_share) and 0 <= raw_share <= 100.01:
            expected = raw_share * denom / 100
            candidates = [votes, votes * 10, votes * 100, votes * 1000]
            scored = []
            for cand in candidates:
                if expected <= 0:
                    break
                rel = abs(cand - expected) / expected
                scored.append((rel, cand))
            if scored:
                rel_best, cand_best = min(scored, key=lambda x: x[0])
                rel_now = scored[0][0]
                if rel_best + 0.02 < rel_now:
                    return cand_best
        return votes

    def recompute_metrics(frame: pd.DataFrame) -> pd.DataFrame:
        out = frame.copy()
        out = out.drop(columns=["sum_party_votes", "share_denominator", "share_method", "vote_share", "rank"], errors="ignore")
        sum_votes = out.groupby(["election_key", "municipality_id"])["votes"].sum(min_count=1).rename("sum_party_votes")
        out = out.merge(sum_votes, on=["election_key", "municipality_id"], how="left")
        denoms = out.apply(lambda r: choose_denominator(r), axis=1)
        out["share_denominator"] = [d[0] for d in denoms]
        out["share_method"] = [d[1] for d in denoms]
        out["votes"] = out.apply(adjusted_votes, axis=1)
        out["vote_share"] = out.apply(
            lambda r: (r["votes"] / r["share_denominator"] * 100) if pd.notna(r["votes"]) and pd.notna(r["share_denominator"]) and r["share_denominator"] > 0 else r.get("vote_share_raw"),
            axis=1,
        )
        return out

    def collapse_implausible_duplicates(frame: pd.DataFrame) -> pd.DataFrame:
        stats = frame.groupby(["election_key", "municipality_id"]).agg(
            row_count=("party_std", "size"),
            unique_party_std=("party_std", "nunique"),
            share_sum=("vote_share", "sum"),
            max_share=("vote_share", "max"),
        ).reset_index()
        bad_groups = stats[
            (stats["row_count"] > stats["unique_party_std"])
            & ((stats["max_share"] > 100.01) | (stats["share_sum"] > 150))
        ][["election_key", "municipality_id"]]
        if bad_groups.empty:
            return frame
        tagged = frame.merge(bad_groups.assign(__collapse__=True), on=["election_key", "municipality_id"], how="left")
        collapse_mask = tagged["__collapse__"].eq(True)
        bad = tagged[collapse_mask].copy()
        good = tagged[~collapse_mask].drop(columns="__collapse__").copy()
        if bad.empty:
            return frame
        bad["__party_key"] = bad["party_std"].fillna(bad["party_raw"]).map(normalize_token)
        sort_cols = ["votes", "vote_share_raw"]
        for col in sort_cols:
            if col not in bad.columns:
                bad[col] = None
        bad = bad.sort_values(sort_cols, ascending=[False, False], na_position="last")
        group_cols = [
            "election_key", "election_year", "election_date", "municipality_id", "municipality_name",
            "province", "region", "__party_key", "territorial_mode", "territorial_status",
            "geometry_id", "valid_votes", "voters"
        ]
        collapsed = bad.groupby(group_cols, as_index=False).agg({
            "party_raw": "first",
            "party_std": "first",
            "party_family": "first",
            "bloc": "first",
            "votes": "max",
            "votes_raw_text": "first",
            "vote_share_raw": "max",
            "comparability_note": lambda s: "|".join(dict.fromkeys(
                [str(v).strip() for v in s if str(v).strip()] + ["party_duplicates_collapsed_max"]
            )),
        })
        collapsed = collapsed.drop(columns="__party_key", errors="ignore")
        return pd.concat([good, collapsed], ignore_index=True, sort=False)

    base = recompute_metrics(base)
    base = collapse_implausible_duplicates(base)
    base = recompute_metrics(base)
    base["comparability_note"] = base.apply(lambda r: f"{r['comparability_note']}|{r['share_method']}" if r.get("comparability_note") else r["share_method"], axis=1)
    base = base[pd.notna(base["vote_share"]) | pd.notna(base["votes"])].copy()
    base["rank"] = base.groupby(["election_key", "municipality_id"])["vote_share"].rank(method="dense", ascending=False)
    return base[CONTRACTS["municipality_results_long.csv"]]


def build_summary(turnout_rows: pd.DataFrame, party_rows: pd.DataFrame) -> pd.DataFrame:
    if turnout_rows.empty and party_rows.empty:
        return pd.DataFrame(columns=CONTRACTS["municipality_summary.csv"])
    if turnout_rows.empty:
        turnout_rows = party_rows[[
            "election_key","election_year","election_date","municipality_id","municipality_name","province","region","geometry_id","territorial_mode","territorial_status"
        ]].drop_duplicates().copy()
        turnout_rows["turnout_pct"] = None
        turnout_rows["electors"] = None
        turnout_rows["voters"] = None
        turnout_rows["valid_votes"] = party_rows.groupby(["election_key", "municipality_id"])["votes"].sum().reindex(turnout_rows.set_index(["election_key", "municipality_id"]).index).values
        turnout_rows["total_votes"] = turnout_rows["valid_votes"]
        turnout_rows["comparability_note"] = "summary_without_turnout"
        turnout_rows["completeness_flag"] = "partial_clean_ingest"

    if party_rows.empty:
        out = turnout_rows.copy()
        out["first_party_std"] = ""
        out["first_party_share"] = None
        out["second_party_std"] = ""
        out["second_party_share"] = None
        out["first_second_margin"] = None
        out["dominant_block"] = ""
        return out[CONTRACTS["municipality_summary.csv"]]

    ranks = party_rows.sort_values(["election_key", "municipality_id", "vote_share"], ascending=[True, True, False]).groupby(["election_key", "municipality_id"]).head(2)
    top = ranks.groupby(["election_key", "municipality_id"]).nth(0).reset_index()
    second = ranks.groupby(["election_key", "municipality_id"]).nth(1).reset_index()
    party_counts = party_rows.groupby(["election_key", "municipality_id"]).size().rename("party_row_count").reset_index()
    merged = turnout_rows.merge(top[["election_key", "municipality_id", "party_std", "vote_share", "bloc"]], on=["election_key", "municipality_id"], how="left")
    merged = merged.rename(columns={"party_std": "first_party_std", "vote_share": "first_party_share", "bloc": "dominant_block"})
    merged = merged.merge(second[["election_key", "municipality_id", "party_std", "vote_share"]], on=["election_key", "municipality_id"], how="left", suffixes=("", "_second"))
    merged = merged.rename(columns={"party_std": "second_party_std", "vote_share": "second_party_share"})
    merged = merged.merge(party_counts, on=["election_key", "municipality_id"], how="left")
    merged["party_row_count"] = merged["party_row_count"].fillna(0).astype(int)
    merged["first_second_margin"] = merged["first_party_share"] - merged["second_party_share"]
    merged["comparability_note"] = merged.apply(
        lambda r: "|".join([
            part for part in [
                str(r.get("comparability_note") or "").strip("|"),
                "party_rows_checked" if (r.get("party_row_count", 0) > 0 and str(r.get("first_party_std") or "").strip()) else "no_party_rows_detected"
            ] if part
        ]),
        axis=1,
    )
    def summarize_completeness(row: pd.Series) -> str:
        base = str(row.get("completeness_flag") or "partial_clean_ingest")
        has_party = row.get("party_row_count", 0) > 0 and str(row.get("first_party_std") or "").strip()
        if has_party:
            return "clean_ingest_party_results_checked" if "partial" not in base else "partial_clean_ingest_party_results_checked"
        return "clean_ingest_turnout_only" if "partial" not in base else "partial_clean_ingest_turnout_only"
    merged["completeness_flag"] = merged.apply(summarize_completeness, axis=1)
    return merged[CONTRACTS["municipality_summary.csv"]]


def build_master_tables(summary_rows: pd.DataFrame, party_rows: pd.DataFrame, elections: List[Dict[str, object]]) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    municipalities = (
        summary_rows[["municipality_id", "municipality_name", "province", "region", "geometry_id", "election_year"]].copy()
        if not summary_rows.empty
        else pd.DataFrame(columns=["municipality_id", "municipality_name", "province", "region", "geometry_id", "election_year"])
    )
    if not municipalities.empty:
        municipalities = municipalities[municipalities["municipality_name"].fillna("").astype(str).str.strip() != ""]
        municipalities = municipalities[municipalities["municipality_id"].notna()]
        municipalities["municipality_id"] = municipalities["municipality_id"].astype(str).str.strip()
        municipalities["municipality_name"] = municipalities["municipality_name"].astype(str).str.strip()
        municipalities["province"] = municipalities["province"].fillna("").astype(str).str.strip()
        municipalities["region"] = municipalities["region"].fillna("").astype(str).str.strip()
        municipalities["geometry_id"] = municipalities["geometry_id"].fillna("").astype(str).str.strip()
        municipalities["election_year"] = pd.to_numeric(municipalities["election_year"], errors="coerce")
        municipalities = municipalities.sort_values(["municipality_id", "election_year", "municipality_name"], ascending=[True, False, True])
        muni_enrichment = municipalities.apply(
            lambda r: pd.Series(lookup_geometry_record(r.get("municipality_name", ""), r.get("province", ""))),
            axis=1,
        )
        municipalities["resolved_geometry_id"] = muni_enrichment["geometry_id"].fillna("")
        municipalities["resolved_province_current"] = muni_enrichment["province"].fillna("")
        municipalities["resolved_province_code_current"] = muni_enrichment["province_code"].fillna("")
        municipalities["resolved_region"] = muni_enrichment.get("region", pd.Series("", index=municipalities.index)).fillna("")
        canonical = municipalities.drop_duplicates(subset=["municipality_id"], keep="first").copy()
        alias_map = (
            municipalities.groupby("municipality_id")["municipality_name"]
            .apply(lambda values: "|".join(dict.fromkeys([str(value).strip() for value in values if str(value).strip() and str(value).strip().lower() != "nan"])))
            .to_dict()
        )
        geometry_ids = municipalities.groupby("municipality_id")["resolved_geometry_id"].apply(
            lambda values: "|".join(dict.fromkeys([str(value).strip() for value in values if str(value).strip()]))
        ).to_dict()
        canonical["name_current"] = canonical["municipality_name"]
        canonical["name_historical"] = canonical.apply(
            lambda r: next(
                (
                    alias for alias in (alias_map.get(r["municipality_id"], "") or "").split("|")
                    if alias and alias != r["municipality_name"]
                ),
                "",
            ),
            axis=1,
        )
        canonical["province_current"] = canonical.apply(
            lambda r: str(r.get("resolved_province_current") or "").strip() or str(r.get("province") or "").strip(),
            axis=1,
        )
        canonical["province_code_current"] = canonical["resolved_province_code_current"]
        canonical["region"] = canonical.apply(
            lambda r: str(r.get("resolved_region") or "").strip() or str(r.get("region") or "").strip(),
            axis=1,
        )
        canonical["geometry_id"] = canonical.apply(
            lambda r: str(r.get("resolved_geometry_id") or "").strip() or str(r.get("geometry_id") or "").strip() or str(r.get("municipality_id") or "").strip(),
            axis=1,
        )
        canonical["valid_from"] = min([e["election_year"] for e in elections], default="")
        canonical["valid_to"] = ""
        canonical["active_current"] = canonical["geometry_id"].apply(lambda value: "true" if str(value).strip() else "")
        canonical["source_status"] = "from_clean_ingest_enriched"
        canonical["alias_names"] = canonical["municipality_id"].map(alias_map).fillna(canonical["municipality_name"])
        canonical["lineage_note"] = canonical["municipality_id"].map(geometry_ids).fillna("").apply(
            lambda value: "bootstrap municipality master; current geometry resolved from lookup"
            if value
            else "bootstrap municipality master; enrich with lineage for historical harmonization"
        )
        canonical["harmonized_group_id"] = canonical["geometry_id"].where(canonical["geometry_id"].astype(str).str.strip() != "", canonical["municipality_id"])
        municipalities = canonical[CONTRACTS["municipalities_master.csv"]]
    else:
        municipalities = pd.DataFrame(columns=CONTRACTS["municipalities_master.csv"])

    if not party_rows.empty:
        parties = party_rows[["party_std", "party_raw", "party_family", "bloc"]].drop_duplicates().copy()
        parties["party_display_name"] = parties["party_std"]
        parties["color"] = parties["party_std"].apply(lambda x: infer_party_meta(str(x))["color"])
        parties["aliases"] = parties["party_raw"]
        parties["valid_from"] = min([e["election_year"] for e in elections], default="")
        parties["valid_to"] = ""
        parties["comparability_note"] = "heuristic_party_parse"
        parties = parties[["party_std","party_display_name","party_family","bloc","color","aliases","valid_from","valid_to","comparability_note"]].drop_duplicates()
    else:
        parties = pd.DataFrame(columns=CONTRACTS["parties_master.csv"])

    lineage = municipalities[["municipality_id", "name_current", "name_historical", "valid_from", "valid_to"]].copy() if not municipalities.empty else pd.DataFrame(columns=["municipality_id", "name_current", "name_historical", "valid_from", "valid_to"])
    if not lineage.empty:
        lineage["municipality_id_stable"] = lineage["municipality_id"]
        lineage["parent_ids"] = ""
        lineage["child_ids"] = ""
        lineage["event_type"] = ""
        lineage["merge_event"] = ""
        lineage["split_event"] = ""
        lineage["rename_event"] = ""
        lineage["province_history"] = ""
        lineage["geometry_strategy"] = "join_on_geometry_id_when_available"
        lineage["notes"] = "bootstrap lineage, to be enriched manually"
        lineage = lineage[CONTRACTS["territorial_lineage.csv"]]
    else:
        lineage = pd.DataFrame(columns=CONTRACTS["territorial_lineage.csv"])

    alias_rows: List[Dict[str, object]] = []
    if not municipalities.empty:
        for row in municipalities.itertuples(index=False):
            base_names = [getattr(row, 'name_current', ''), getattr(row, 'name_historical', '')]
            seen = set()
            for alias in base_names:
                alias = str(alias or '').strip()
                if not alias or alias.lower() == 'nan' or alias in seen:
                    continue
                seen.add(alias)
                alias_rows.append({
                    'municipality_id': getattr(row, 'municipality_id'),
                    'alias': alias,
                    'alias_type': 'current_name' if alias == getattr(row, 'name_current', '') else 'historical_name',
                    'valid_from': getattr(row, 'valid_from', ''),
                    'valid_to': getattr(row, 'valid_to', ''),
                    'notes': 'bootstrap alias'
                })
                norm_alias = normalize_municipality_name(alias)
                if norm_alias and norm_alias not in seen and norm_alias != alias:
                    seen.add(norm_alias)
                    alias_rows.append({
                        'municipality_id': getattr(row, 'municipality_id'),
                        'alias': norm_alias,
                        'alias_type': 'normalized_name',
                        'valid_from': getattr(row, 'valid_from', ''),
                        'valid_to': getattr(row, 'valid_to', ''),
                        'notes': 'generated normalized alias'
                    })
    aliases = pd.DataFrame(alias_rows, columns=CONTRACTS["municipality_aliases.csv"]).drop_duplicates() if alias_rows else pd.DataFrame(columns=CONTRACTS["municipality_aliases.csv"])
    return municipalities, parties, lineage, aliases


def validate_derived(summary_rows: pd.DataFrame, party_rows: pd.DataFrame) -> Dict[str, object]:
    validations: List[Dict[str, object]] = []

    def add_issue(severity: str, check: str, scope: str, details: str, affected_rows: int = 0) -> None:
        validations.append({"severity": severity, "check": check, "scope": scope, "details": details, "affected_rows": int(affected_rows)})

    if not party_rows.empty:
        bad_share = party_rows[(party_rows["vote_share"].notna()) & ((party_rows["vote_share"] < -0.01) | (party_rows["vote_share"] > 100.01))]
        if not bad_share.empty:
            add_issue("warning", "vote_share_range", "municipality_results_long", "Quote fuori range [0,100].", len(bad_share))

        share_sum = party_rows.groupby(["election_key", "municipality_id"])["vote_share"].sum(min_count=1).reset_index(name="share_sum")
        odd_sum = share_sum[(share_sum["share_sum"].notna()) & ((share_sum["share_sum"] < 90) | (share_sum["share_sum"] > 110))]
        if not odd_sum.empty:
            add_issue("warning", "share_sum_plausibility", "municipality_results_long", "Somma quote per comune lontana da 100 ± 10.", len(odd_sum))

    if not summary_rows.empty:
        bad_turnout = summary_rows[(summary_rows["turnout_pct"].notna()) & ((summary_rows["turnout_pct"] < 0) | (summary_rows["turnout_pct"] > 100))]
        if not bad_turnout.empty:
            add_issue("error", "turnout_range", "municipality_summary", "Affluenza fuori range [0,100].", len(bad_turnout))

        bad_counts = summary_rows[(summary_rows["electors"].notna()) & (summary_rows["voters"].notna()) & (summary_rows["electors"] < summary_rows["voters"])]
        if not bad_counts.empty:
            add_issue("error", "electors_vs_voters", "municipality_summary", "Elettori minori dei votanti.", len(bad_counts))

        bad_valid = summary_rows[(summary_rows["voters"].notna()) & (summary_rows["valid_votes"].notna()) & (summary_rows["valid_votes"] > summary_rows["voters"])]
        if not bad_valid.empty:
            add_issue("error", "valid_votes_vs_voters", "municipality_summary", "Voti validi maggiori dei votanti.", len(bad_valid))

        turnout_from_counts = summary_rows[(summary_rows["electors"].notna()) & (summary_rows["voters"].notna()) & (summary_rows["electors"] > 0)].copy()
        if not turnout_from_counts.empty:
            turnout_from_counts["turnout_from_counts"] = turnout_from_counts["voters"] / turnout_from_counts["electors"] * 100
            turnout_mismatch = turnout_from_counts[(turnout_from_counts["turnout_pct"].notna()) & ((turnout_from_counts["turnout_from_counts"] - turnout_from_counts["turnout_pct"]).abs() > 1.5)]
            if not turnout_mismatch.empty:
                add_issue("warning", "turnout_vs_counts", "municipality_summary", "Affluenza incoerente con votanti/elettori oltre 1.5 punti.", len(turnout_mismatch))

        missing_province = summary_rows[summary_rows["municipality_name"].notna() & summary_rows["municipality_name"].astype(str).str.strip().ne("") & summary_rows["province"].fillna("").astype(str).str.strip().eq("")]
        if not missing_province.empty:
            add_issue("warning", "missing_province", "municipality_summary", "Provincia vuota su righe comunali osservate.", len(missing_province))
        misleading_complete = summary_rows[(summary_rows["first_party_std"].fillna("").astype(str).str.strip().eq("")) & summary_rows["comparability_note"].fillna("").astype(str).str.contains("party_rows_checked", regex=False)]
        if not misleading_complete.empty:
            add_issue("error", "misleading_party_rows_checked", "municipality_summary", "Flag di partito presente ma leader mancante.", len(misleading_complete))

        turnout_only_flag = summary_rows[(summary_rows["first_party_std"].fillna("").astype(str).str.strip().eq("")) & ~summary_rows["completeness_flag"].fillna("").astype(str).str.contains("turnout_only", regex=False)]
        if not turnout_only_flag.empty:
            add_issue("warning", "completeness_semantics", "municipality_summary", "Righe senza partiti non marcate come turnout_only.", len(turnout_only_flag))

    if not summary_rows.empty and not party_rows.empty:
        valid_by_results = party_rows.groupby(["election_key", "municipality_id"])["votes"].sum(min_count=1).reset_index(name="votes_sum")
        merged = summary_rows.merge(valid_by_results, on=["election_key", "municipality_id"], how="left")
        mismatch_votes = merged[(merged["valid_votes"].notna()) & (merged["votes_sum"].notna()) & (merged["valid_votes"] > 0) & (((merged["votes_sum"] - merged["valid_votes"]).abs() / merged["valid_votes"]) > 0.08)]
        if not mismatch_votes.empty:
            add_issue("warning", "party_votes_vs_valid_votes", "derived_consistency", "Somma voti per partito lontana dai voti validi oltre l'8%.", len(mismatch_votes))

        leader_by_results = party_rows.sort_values(["election_key", "municipality_id", "vote_share"], ascending=[True, True, False]).groupby(["election_key", "municipality_id"]).head(1)
        leader_check = summary_rows.merge(leader_by_results[["election_key", "municipality_id", "party_std", "vote_share"]], on=["election_key", "municipality_id"], how="left")
        bad_leader = leader_check[(leader_check["first_party_std"].fillna('') != '') & (leader_check["party_std"].fillna('') != '') & ((leader_check["first_party_std"] != leader_check["party_std"]) | ((leader_check["first_party_share"].fillna(-999) - leader_check["vote_share"].fillna(-999)).abs() > 0.6))]
        if not bad_leader.empty:
            add_issue("warning", "summary_leader_vs_results", "derived_consistency", "Primo partito/quote nel summary incoerenti con i risultati long.", len(bad_leader))

    readiness = 100
    for issue in validations:
        readiness -= 25 if issue["severity"] == "error" else 10
    readiness = max(0, readiness)
    return {
        "issues": validations,
        "issue_count": len(validations),
        "readiness_score": readiness,
        "technical_readiness_score": readiness,
        "has_errors": any(i["severity"] == "error" for i in validations),
    }


def locate_ingest_layout(source_root: Path, election_key: str) -> Tuple[Optional[Path], Optional[Path]]:
    election_dir = source_root / election_key
    candidates = [
        (election_dir / "validated" / "clean", election_dir / "validated" / "raw" / "entities.csv"),
        (election_dir / "existing" / "clean", election_dir / "existing" / "raw" / "entities.csv"),
        (election_dir / "raw_option_urls" / "clean", election_dir / "raw_option_urls" / "raw" / "entities.csv"),
        (source_root / f"{election_key}_clean", source_root / f"{election_key}_raw" / "entities.csv"),
    ]
    for clean_dir, raw_entities in candidates:
        if clean_dir.exists():
            return clean_dir, raw_entities if raw_entities.exists() else None
    return None, None


def parse_clean_payloads(source_root: Path, elections: List[Dict[str, object]]) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, Dict[str, object]]:
    turnout_parts, party_parts, parse_log = [], [], []
    for election in elections:
        year = election["election_year"]
        clean_dir, raw_entities = locate_ingest_layout(source_root, election["election_key"])
        if not clean_dir:
            parse_log.append({"election_key": election["election_key"], "status": "skipped_no_clean"})
            continue
        meta_by_url = build_metadata_map(raw_entities if raw_entities and raw_entities.exists() else None)
        turnout = parse_turnout_rows(clean_dir, meta_by_url, election)
        party_raw = parse_party_rows(clean_dir, meta_by_url, election)
        turnout_parts.append(turnout)
        party_parts.append(party_raw)
        parse_log.append({
            "election_key": election["election_key"],
            "status": "parsed_with_data" if (len(turnout) or len(party_raw)) else "parsed_empty",
            "municipality_rows": int(len(turnout)),
            "party_rows_raw": int(len(party_raw))
        })
    turnout_rows = pd.concat([df for df in turnout_parts if not df.empty], ignore_index=True) if any(not df.empty for df in turnout_parts) else pd.DataFrame(columns=["election_key"])
    party_rows_raw = pd.concat([df for df in party_parts if not df.empty], ignore_index=True) if any(not df.empty for df in party_parts) else pd.DataFrame(columns=["election_key"])
    party_rows = normalize_party_rows(turnout_rows, party_rows_raw)
    summary_rows = build_summary(turnout_rows, party_rows)
    municipalities, parties, lineage, aliases = build_master_tables(summary_rows, party_rows, elections)
    validations = validate_derived(summary_rows, party_rows)
    extras = {"parse_log": parse_log, "validations": validations}
    return summary_rows, party_rows, municipalities, parties, lineage, aliases, extras


def finalize_elections_master(elections: List[Dict[str, object]], summary_rows: pd.DataFrame, party_rows: pd.DataFrame) -> List[Dict[str, object]]:
    summary_counts = summary_rows.groupby("election_key").size().to_dict() if not summary_rows.empty else {}
    party_counts = party_rows.groupby("election_key").size().to_dict() if not party_rows.empty else {}
    out: List[Dict[str, object]] = []
    for election in elections:
        row = dict(election)
        key = row.get("election_key")
        summary_n = int(summary_counts.get(key, 0))
        party_n = int(party_counts.get(key, 0))
        if row.get("status") == "completed" and summary_n == 0:
            row["status"] = "completed_without_rows"
            row["is_complete"] = "false"
            notes = str(row.get("comparability_notes") or "")
            suffix = "derived summary assente nel bundle corrente"
            row["comparability_notes"] = f"{notes}; {suffix}".strip("; ").strip()
        row["source_notes"] = f"{row.get('source_notes','')}; summary_rows={summary_n}; result_rows={party_n}".strip("; ").strip()
        out.append(row)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare derived scaffolding for Electio Italia")
    parser.add_argument("--source-root", required=True, help="Root with camera_YYYY folders and optional *_clean / *_raw")
    parser.add_argument("--output-root", required=True, help="App project root")
    args = parser.parse_args()

    source_root = Path(args.source_root)
    output_root = Path(args.output_root)
    global GEOMETRY_LOOKUP
    GEOMETRY_LOOKUP = load_geometry_lookup(output_root / "data" / "reference")
    derived = output_root / "data" / "derived"
    derived.mkdir(parents=True, exist_ok=True)

    elections = infer_elections(source_root)
    quality = build_quality_report(source_root)

    for filename, headers in CONTRACTS.items():
        ensure_contract_csv(derived / filename, headers)

    summary_rows, party_rows, municipalities, parties, lineage, aliases, extras = parse_clean_payloads(source_root, elections)
    if not summary_rows.empty:
        summary_rows.to_csv(derived / "municipality_summary.csv", index=False)
    if not party_rows.empty:
        party_rows.to_csv(derived / "municipality_results_long.csv", index=False)
    write_results_long_shards(output_root, party_rows)
    if not municipalities.empty:
        municipalities.to_csv(derived / "municipalities_master.csv", index=False)
    if not parties.empty:
        parties.to_csv(derived / "parties_master.csv", index=False)
    if not lineage.empty:
        lineage.to_csv(derived / "territorial_lineage.csv", index=False)
    aliases.to_csv(derived / "municipality_aliases.csv", index=False)

    elections = finalize_elections_master(elections, summary_rows, party_rows)
    pd.DataFrame(elections).to_csv(derived / "elections_master.csv", index=False)

    derived_validations = extras.get("validations", {})
    total_elections = max(len(elections), 1)
    summary_covered = summary_rows["election_key"].nunique() if not summary_rows.empty else 0
    result_covered = party_rows["election_key"].nunique() if not party_rows.empty else 0
    substantive_score = round(((summary_covered / total_elections) * 0.7 + (result_covered / total_elections) * 0.3) * 100)
    derived_validations["substantive_coverage_score"] = substantive_score
    quality["derived_validations"] = derived_validations
    write_json_file(derived / "data_quality_report.json", quality)

    geometry_path = derived / "lombardia_municipalities.geojson"
    if not geometry_path.exists():
        write_json_file(geometry_path, {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "placeholder": True,
                "note": "Replace with real municipal geometries."
            }
        })
    province_geometry_path = derived / "lombardia_provinces.geojson"
    if not province_geometry_path.exists():
        write_json_file(province_geometry_path, {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "placeholder": True,
                "note": "Replace with real provincial geometries."
            }
        })
    write_geometry_pack(output_root)
    write_manifest(output_root)
    geometry_info = geometry_manifest_files(output_root)
    dataset_registry = build_dataset_registry(output_root, elections, summary_rows, party_rows, quality)
    codebook = build_codebook_payload()
    usage_notes = build_usage_notes_payload(quality, geometry_info)
    update_log = build_update_log_payload()
    data_products = build_data_products_payload()
    dataset_contracts = build_dataset_contracts_payload()
    research_recipes = build_research_recipes_payload()
    site_guides = load_or_default_site_guides(output_root)
    write_json_file(derived / "dataset_registry.json", dataset_registry)
    write_json_file(derived / "codebook.json", codebook)
    write_json_file(derived / "usage_notes.json", usage_notes)
    write_json_file(derived / "update_log.json", update_log)
    write_json_file(derived / "data_products.json", data_products)
    write_json_file(derived / "dataset_contracts.json", dataset_contracts)
    write_json_file(derived / "research_recipes.json", research_recipes)
    write_json_file(derived / "site_guides.json", site_guides)
    provenance = build_provenance_payload(output_root)
    write_json_file(derived / "provenance.json", provenance)
    write_manifest(output_root)
    release_manifest = build_release_manifest(output_root)
    write_json_file(derived / "release_manifest.json", release_manifest)
    write_json_file(derived / "preprocess_log.json", sanitize_for_bundle(extras))
    print(f"Derived scaffolding + hardened ingest written to: {output_root}")


if __name__ == "__main__":
    main()
