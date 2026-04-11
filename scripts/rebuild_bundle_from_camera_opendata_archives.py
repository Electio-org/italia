#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import time
import unicodedata
import zipfile
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from difflib import SequenceMatcher

import pandas as pd

import preprocess


CURRENT_VERSION = "0.15.0"
DEFAULT_MANIFEST = Path(r"D:\camera_lombardia_only_suite_v5\lombardia_camera_app_v35\data\reference\camera_opendata_archives_manifest.json")
DEFAULT_OUTPUT_ROOT = Path(r"D:\camera_lombardia_only_suite_v5\lombardia_camera_app_v35")

LOMBARDY_PROVINCES = {
    "bergamo",
    "brescia",
    "como",
    "cremona",
    "lecco",
    "lodi",
    "mantova",
    "milano",
    "monza e brianza",
    "pavia",
    "sondrio",
    "varese",
}

ITALY_REGIONS = {
    "piemonte": "Piemonte",
    "valle d aosta": "Valle d'Aosta",
    "valle d aosta vallee d aoste": "Valle d'Aosta",
    "lombardia": "Lombardia",
    "trentino alto adige": "Trentino-Alto Adige",
    "trentino alto adige sudtirol": "Trentino-Alto Adige",
    "veneto": "Veneto",
    "friuli venezia giulia": "Friuli-Venezia Giulia",
    "liguria": "Liguria",
    "emilia romagna": "Emilia-Romagna",
    "toscana": "Toscana",
    "umbria": "Umbria",
    "marche": "Marche",
    "lazio": "Lazio",
    "abruzzo": "Abruzzo",
    "molise": "Molise",
    "campania": "Campania",
    "puglia": "Puglia",
    "basilicata": "Basilicata",
    "calabria": "Calabria",
    "sicilia": "Sicilia",
    "sardegna": "Sardegna",
}

MANUAL_NAME_ALIASES = {
    "balabio": "Ballabio",
    "cerreto lomellino": "Ceretto Lomellina",
    "andriano andrian": "Andriano",
    "montagna montan": "Montagna",
    "postal burgstall": "Postal",
    "salorno sulla strada del vino salurn an der weinstrasse": "Salorno sulla Strada del Vino",
    "braies prags": "Braies",
    "corvara in badia corvara": "Corvara in Badia",
    "ponte gardena waidbruck": "Ponte Gardena",
    "prato allo stelvio prad am stilfser joch": "Prato allo Stelvio",
    "renon ritten": "Renon",
    "rio di pusteria muhlbach": "Rio di Pusteria",
    "rio di pusteria m hlbach": "Rio di Pusteria",
    "san leonardo in passiria st leonhard in passeier": "San Leonardo in Passiria",
    "san lorenzo di sebato st lorenzen": "San Lorenzo di Sebato",
    "ionadi": "Jonadi",
    "baiardo": "Bajardo",
    "san remo": "Sanremo",
    "sannicandro garganico": "San Nicandro Garganico",
    "castel mola": "Castelmola",
    "montecompatri": "Monte Compatri",
    "santo stino di livenza": "San Stino di Livenza",
    "negrar": "Negrar di Valpolicella",
    "cerreto langhe": "Cerretto Langhe",
    "cerreto delle langhe": "Cerretto Langhe",
    "donnaz": "Donnas",
    "emar se": "Emarese",
    "f nis": "Fenis",
    "verr s": "Verres",
}

MANUAL_REFERENCE_OVERRIDES = {
    "di brescia": {"municipality_id": "017029", "geometry_id": "017029", "province": "Brescia", "name_current": "Brescia"},
    "zeme lomellina": {"municipality_id": "018186", "geometry_id": "018186", "province": "Pavia", "name_current": "Zeme"},
    "monticello": {"municipality_id": "097054", "geometry_id": "097054", "province": "Lecco", "name_current": "Monticello Brianza"},
    "costa di serina": {"municipality_id": "costa-di-serina", "geometry_id": "costa-di-serina", "province": "Bergamo", "name_current": "Costa di Serina"},
    "persico d osimo": {"municipality_id": "019068", "geometry_id": "019068", "province": "Cremona", "name_current": "Persico Dosimo"},
    "oltrona san mamette": {"municipality_id": "013169", "geometry_id": "013169", "province": "Como", "name_current": "Oltrona di San Mamette"},
    "san fermo d battaglia": {"municipality_id": "013206", "geometry_id": "013206", "province": "Como", "name_current": "San Fermo della Battaglia"},
    "pianello lario": {"municipality_id": "013183", "geometry_id": "013183", "province": "Como", "name_current": "Pianello del Lario"},
    "san bartolomeo v c": {"municipality_id": "013204", "geometry_id": "013204", "province": "Como", "name_current": "San Bartolomeo Val Cavargna"},
    "san nazzaro v c": {"municipality_id": "013207", "geometry_id": "013207", "province": "Como", "name_current": "San Nazzaro Val Cavargna"},
    "valrezzo": {"municipality_id": "013233", "geometry_id": "013233", "province": "Como", "name_current": "Val Rezzo"},
    "parte di comune brescia": {"municipality_id": "017029", "geometry_id": "017029", "province": "Brescia", "name_current": "Brescia"},
    "balabio": {"municipality_id": "097004", "geometry_id": "097004", "province": "Lecco", "name_current": "Ballabio"},
    "cerreto lomellino": {"municipality_id": "018044", "geometry_id": "018044", "province": "Pavia", "name_current": "Ceretto Lomellina"},
}

SUMMARY_COLUMNS = preprocess.CONTRACTS["municipality_summary.csv"]
RESULT_COLUMNS = preprocess.CONTRACTS["municipality_results_long.csv"]
MASTER_COLUMNS = preprocess.CONTRACTS["municipalities_master.csv"]
PARTY_MASTER_COLUMNS = preprocess.CONTRACTS["parties_master.csv"]
LINEAGE_COLUMNS = preprocess.CONTRACTS["territorial_lineage.csv"]
ALIASES_COLUMNS = preprocess.CONTRACTS["municipality_aliases.csv"]

NEEDED_ARCHIVE_COLUMNS = {
    "CIRCOSCRIZIONE",
    "CIRC-REG",
    "PROVINCIA",
    "COMUNE",
    "ELETTORI",
    "ELETTORITOT",
    "ELETTORITOTALI",
    "VOTANTI",
    "VOTANTITOT",
    "NUMVOTANTITOTALI",
    "VOTI_LISTA",
    "VOTILISTA",
    "LISTA",
    "DESCRLISTA",
    "COLLEGIOUNINOMINALE",
    "COLLUNINOM",
    "COLLEGIO",
    "COLLEGIOPLURINOMINALE",
    "COLLPLURI",
}


def log_step(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fix_mojibake(text: str) -> str:
    value = preprocess.fix_text(str(text or ""))
    replacements = {
        "Ã¹": "ù",
        "Ã²": "ò",
        "Ã ": "à",
        "Ã¨": "è",
        "Ã©": "é",
        "Ã¬": "ì",
        "Â": "",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    return value


def normalize_lookup_key(value: str) -> str:
    text = fix_mojibake(value).strip()
    if not text:
        return ""
    text = re.sub(r"(?i)^parte d(?:el|i) comune(?: di)?\s+", "", text)
    text = text.replace("&", " e ")
    text = text.replace("'", " ").replace("’", " ").replace("`", " ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def compact_lookup_key(value: str) -> str:
    return normalize_lookup_key(value).replace(" ", "")


def normalize_region_label(value: str) -> str:
    key = normalize_lookup_key(value)
    return ITALY_REGIONS.get(key, smart_title(value))


def candidate_lookup_keys(value: str) -> List[str]:
    raw = fix_mojibake(value).strip()
    keys: List[str] = []

    def add(candidate: str) -> None:
        key = normalize_lookup_key(candidate)
        if key and key not in keys:
            keys.append(key)
        compact = key.replace(" ", "")
        if compact and len(compact) >= 5 and compact not in keys:
            keys.append(compact)

    add(raw)
    if "/" in raw:
        for part in raw.split("/"):
            add(part)
    alias = MANUAL_NAME_ALIASES.get(normalize_lookup_key(raw))
    if alias:
        add(alias)
    return keys


def register_reference_alias(
    by_name_prov: Dict[Tuple[str, str], Dict[str, str]],
    by_name_region: Dict[Tuple[str, str], Dict[str, str]],
    candidates_by_name: Dict[str, List[Dict[str, str]]],
    name: str,
    province_key: str,
    region_key: str,
    record: Dict[str, str],
) -> None:
    for key in candidate_lookup_keys(name):
        candidates_by_name.setdefault(key, []).append(record)
        by_name_prov.setdefault((key, province_key), record)
        if region_key:
            by_name_region.setdefault((key, region_key), record)


def region_from_circ_raw(value: str) -> str:
    key = normalize_lookup_key(value)
    if not key:
        return ""
    for region_key, region_label in sorted(ITALY_REGIONS.items(), key=lambda item: len(item[0]), reverse=True):
        if key == region_key or key.startswith(region_key) or f" {region_key} " in f" {key} ":
            return region_label
    return ""


def smart_title(value: str) -> str:
    text = fix_mojibake(str(value or "")).strip().strip('"')
    if not text:
        return ""
    if any(ch.islower() for ch in text):
        return re.sub(r"\s+", " ", text).strip()
    lowered = text.lower()
    titled = lowered.title()
    replacements = {
        " Di ": " di ",
        " Del ": " del ",
        " Della ": " della ",
        " Delle ": " delle ",
        " Dei ": " dei ",
        " Degli ": " degli ",
        " E ": " e ",
        " In ": " in ",
        " Sul ": " sul ",
        " Sulla ": " sulla ",
        " Al ": " al ",
        " Alla ": " alla ",
        " Da ": " da ",
        " De ": " de ",
        " D'": " d'",
        " L'": " l'",
    }
    for old, new in replacements.items():
        titled = titled.replace(old, new)
    if titled.startswith("L'"):
        titled = "L'" + titled[2:].capitalize()
    if titled.startswith("D'"):
        titled = "D'" + titled[2:].capitalize()
    return re.sub(r"\s+", " ", titled).strip()


def iso_date_from_archive(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(\d{2})/(\d{2})/(\d{4})", text)
    if not match:
        return ""
    dd, mm, yyyy = match.groups()
    return f"{yyyy}-{mm}-{dd}"


def safe_int(value: object) -> Optional[int]:
    return preprocess.safe_count(value)


def first_nonempty(payload: Dict[str, str], columns: Iterable[str]) -> str:
    for key in columns:
        raw = payload.get(key, "")
        text = fix_mojibake(str(raw or "")).strip().strip('"')
        if text:
            return text
    return ""


def choose_primary_member(entry: Dict[str, object]) -> str:
    members = [str(name) for name in entry.get("members") or []]
    year = int(entry["year"])
    election_type = str(entry.get("election_type") or "camera").strip().lower()
    text_members = []
    for name in members:
        lower = name.lower()
        if not (lower.endswith(".txt") or lower.endswith(".csv")):
            continue
        if any(token in lower for token in ("preferenze", "candidati", "estero", "vaosta")):
            continue
        text_members.append(name)
    if not text_members:
        raise RuntimeError(f"Nessun member tabellare utile per {entry['filename']}")
    if year == 2018:
        for name in text_members:
            if "livcomune" in name.lower():
                return name
    if year == 2022:
        for name in text_members:
            low = name.lower()
            if "livcomune" in low and "italia" in low:
                return name
    if election_type == "assemblea_costituente":
        for name in text_members:
            if "assemblea_costituente" in name.lower():
                return name
    for token in ("proporzionale", "camera_italia", "camera-", "assemblea_costituente"):
        for name in text_members:
            if token in name.lower():
                return name
    return text_members[0]


def decode_member(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except Exception:
            continue
    raise UnicodeDecodeError("opendata", b"", 0, 1, "unable to decode archive member")


def canonical_observed_name(raw_name: str) -> Tuple[str, str]:
    observed = smart_title(raw_name)
    base = re.sub(r"(?i)^parte d(?:el|i) comune(?: di)?\s+", "", observed).strip()
    if re.fullmatch(r"(?i)milano\s+\d+", base):
        base = "Milano"
    return observed, smart_title(base)


def fallback_municipality_id(name: str, province: str) -> str:
    base = name if not province else f"{name}-{province}"
    return preprocess.slugify(base)


def consultation_key_for_entry(entry: Dict[str, object]) -> str:
    year = int(entry["year"])
    election_type = str(entry.get("election_type") or "camera").strip().lower()
    if election_type == "assemblea_costituente":
        return f"assemblea_costituente_{year}"
    return f"camera_{year}"


def election_label_for_entry(entry: Dict[str, object]) -> str:
    year = int(entry["year"])
    election_type = str(entry.get("election_type") or "camera").strip().lower()
    if election_type == "assemblea_costituente":
        return f"Assemblea Costituente {year}"
    return f"Camera {year}"


def electoral_system_for_entry(entry: Dict[str, object]) -> str:
    year = int(entry["year"])
    election_type = str(entry.get("election_type") or "camera").strip().lower()
    if election_type == "assemblea_costituente":
        return "constituent_assembly_list"
    if year <= 1992:
        return "proportional_list"
    return "mixed_member"


def load_reference_maps(
    output_root: Path,
    reference_year: Optional[int] = None,
) -> Tuple[
    Dict[Tuple[str, str], Dict[str, str]],
    Dict[Tuple[str, str], Dict[str, str]],
    Dict[str, Dict[str, str]],
    Dict[Tuple[str, str], Dict[str, str]],
    Dict[Tuple[str, str], Dict[str, str]],
    Dict[str, Dict[str, str]],
]:
    geometry_by_name_prov: Dict[Tuple[str, str], Dict[str, str]] = {}
    geometry_by_name_region: Dict[Tuple[str, str], Dict[str, str]] = {}
    geometry_name_candidates: Dict[str, List[Dict[str, str]]] = {}
    geometry_by_name: Dict[str, Dict[str, str]] = {}
    historical_by_name_prov: Dict[Tuple[str, str], Dict[str, str]] = {}
    historical_by_name_region: Dict[Tuple[str, str], Dict[str, str]] = {}
    historical_name_candidates: Dict[str, List[Dict[str, str]]] = {}
    historical_by_name: Dict[str, Dict[str, str]] = {}
    geom_dir = output_root / "data" / "derived" / "geometries"
    all_geometry_paths = sorted(geom_dir.glob("municipalities_*.geojson"))
    geometry_paths = list(all_geometry_paths)
    if reference_year is not None:
        eligible = []
        for path in geometry_paths:
            match = re.search(r"(\d{4})", path.stem)
            year = int(match.group(1)) if match else None
            if year is not None and year <= int(reference_year):
                eligible.append((year, path))
        if eligible:
            geometry_paths = [sorted(eligible, key=lambda item: item[0])[-1][1]]
    if geometry_paths:
        geometry_paths = [geometry_paths[-1]]
    for path in geometry_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for feature in payload.get("features") or []:
            props = feature.get("properties") or {}
            name = str(props.get("name_current") or props.get("name") or "").strip()
            province = str(props.get("province") or "").strip()
            region = str(props.get("region") or "").strip()
            if not name:
                continue
            record = {
                "municipality_id": str(props.get("municipality_id") or props.get("geometry_id") or "").strip(),
                "geometry_id": str(props.get("geometry_id") or props.get("municipality_id") or "").strip(),
                "province": smart_title(province),
                "region": smart_title(region),
                "name_current": smart_title(name),
            }
            key = normalize_lookup_key(name)
            prov_key = normalize_lookup_key(province)
            region_key = normalize_lookup_key(region)
            register_reference_alias(geometry_by_name_prov, geometry_by_name_region, geometry_name_candidates, name, prov_key, region_key, record)
    for key, records in geometry_name_candidates.items():
        unique_ids = {(row["municipality_id"], row["geometry_id"]) for row in records}
        if len(unique_ids) == 1 and records:
            geometry_by_name[key] = records[0]
    for path in all_geometry_paths:
        match = re.search(r"(\d{4})", path.stem)
        path_year = int(match.group(1)) if match else 0
        payload = json.loads(path.read_text(encoding="utf-8"))
        for feature in payload.get("features") or []:
            props = feature.get("properties") or {}
            name = str(props.get("name_current") or props.get("name") or "").strip()
            province = str(props.get("province") or "").strip()
            region = str(props.get("region") or "").strip()
            if not name:
                continue
            record = {
                "municipality_id": str(props.get("municipality_id") or props.get("geometry_id") or "").strip(),
                "geometry_id": str(props.get("geometry_id") or props.get("municipality_id") or "").strip(),
                "province": smart_title(province),
                "region": smart_title(region),
                "name_current": smart_title(name),
                "_year": path_year,
            }
            key = normalize_lookup_key(name)
            prov_key = normalize_lookup_key(province)
            region_key = normalize_lookup_key(region)
            register_reference_alias(historical_by_name_prov, historical_by_name_region, historical_name_candidates, name, prov_key, region_key, record)
    for key, records in historical_name_candidates.items():
        if records:
            historical_by_name[key] = sorted(records, key=lambda row: int(row.get("_year") or 0))[-1]
    for record in list(historical_by_name.values()) + list(historical_by_name_prov.values()):
        record.pop("_year", None)
    for record in historical_by_name_region.values():
        record.pop("_year", None)
    return geometry_by_name_prov, geometry_by_name_region, geometry_by_name, historical_by_name_prov, historical_by_name_region, historical_by_name


def resolve_reference(
    municipality_name: str,
    province: str,
    region: str,
    geometry_by_name_prov: Dict[Tuple[str, str], Dict[str, str]],
    geometry_by_name_region: Dict[Tuple[str, str], Dict[str, str]],
    geometry_by_name: Dict[str, Dict[str, str]],
    master_by_name_prov: Dict[Tuple[str, str], Dict[str, str]],
    master_by_name_region: Dict[Tuple[str, str], Dict[str, str]],
    master_by_name: Dict[str, Dict[str, str]],
) -> Tuple[Optional[Dict[str, str]], str]:
    name_key = normalize_lookup_key(municipality_name)
    province_key = normalize_lookup_key(province)
    region_key = normalize_lookup_key(region)
    for candidate_key in candidate_lookup_keys(municipality_name):
        if candidate_key in MANUAL_REFERENCE_OVERRIDES:
            return MANUAL_REFERENCE_OVERRIDES[candidate_key], "manual_override"
        if (candidate_key, province_key) in geometry_by_name_prov:
            return geometry_by_name_prov[(candidate_key, province_key)], "geometry_name_province"
        if (candidate_key, region_key) in geometry_by_name_region:
            return geometry_by_name_region[(candidate_key, region_key)], "geometry_name_region"
        if candidate_key in geometry_by_name:
            return geometry_by_name[candidate_key], "geometry_name"
        if (candidate_key, province_key) in master_by_name_prov:
            return master_by_name_prov[(candidate_key, province_key)], "historical_geometry_name_province"
        if (candidate_key, region_key) in master_by_name_region:
            return master_by_name_region[(candidate_key, region_key)], "historical_geometry_name_region"
        if candidate_key in master_by_name:
            return master_by_name[candidate_key], "historical_geometry_name"

    if province_key:
        candidates = []
        for candidate_key in candidate_lookup_keys(municipality_name):
            for (candidate_name, candidate_prov), record in master_by_name_prov.items():
                if candidate_prov != province_key:
                    continue
                if candidate_name.startswith(candidate_key) or candidate_key.startswith(candidate_name):
                    candidates.append(record)
                    if len(candidates) > 3:
                        break
        unique_ids = {(row["municipality_id"], row["geometry_id"]) for row in candidates}
        if len(unique_ids) == 1 and candidates:
            return candidates[0], "historical_geometry_prefix_province"

    candidates = []
    for candidate_key in candidate_lookup_keys(municipality_name):
        for key, record in master_by_name.items():
            if key.startswith(candidate_key) or candidate_key.startswith(key):
                candidates.append(record)
                if len(candidates) > 3:
                    break
    unique_ids = {(row["municipality_id"], row["geometry_id"]) for row in candidates}
    if len(unique_ids) == 1 and candidates:
        return candidates[0], "historical_geometry_prefix"

    if region_key:
        fuzzy = []
        for (candidate_name, candidate_region), record in geometry_by_name_region.items():
            if candidate_region != region_key or abs(len(candidate_name) - len(name_key)) > 8:
                continue
            score = SequenceMatcher(None, name_key, candidate_name).ratio()
            if score >= 0.91:
                fuzzy.append((score, record))
        unique_ids = {(row["municipality_id"], row["geometry_id"]) for _, row in fuzzy}
        if len(unique_ids) == 1 and fuzzy:
            return sorted(fuzzy, key=lambda item: item[0], reverse=True)[0][1], "geometry_name_region_fuzzy"
    return None, ""


def read_archive_rows(entry: Dict[str, object]) -> Tuple[str, List[Dict[str, str]]]:
    member = choose_primary_member(entry)
    with zipfile.ZipFile(str(entry["local_path"])) as archive:
        data = archive.read(member)
    text = decode_member(data)
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    rows = []
    for row in reader:
        cleaned = {}
        for key, value in row.items():
            clean_key = str(key or "").strip().strip('"')
            if clean_key not in NEEDED_ARCHIVE_COLUMNS:
                continue
            clean_value = str(value or "").strip().strip('"')
            cleaned[clean_key] = clean_value
        rows.append(cleaned)
    return member, rows


def build_gap_report(
    output_root: Path,
    source_rows: List[Dict[str, object]],
    summary_rows: pd.DataFrame,
    party_rows: pd.DataFrame,
    dataset_registry: Dict[str, object],
) -> None:
    registry_rows = {str(row.get("dataset_key")): row for row in dataset_registry.get("datasets") or []}
    report_rows = []
    for item in source_rows:
        key = str(item["election_key"])
        bundle_summary = summary_rows[summary_rows["election_key"] == key] if not summary_rows.empty else pd.DataFrame()
        bundle_results = party_rows[party_rows["election_key"] == key] if not party_rows.empty else pd.DataFrame()
        bundle_unique = int(bundle_summary["municipality_id"].nunique()) if not bundle_summary.empty else 0
        expected = int(item["expected_bundle_rows"])
        ratio = round(bundle_unique / expected, 4) if expected else None
        flags: List[str] = []
        if expected > 0 and bundle_unique == 0:
            flags.append("bundle_empty_archive_nonempty")
        if expected > 0 and bundle_unique < expected:
            flags.append("bundle_below_archive_positive_tables")
        if expected > 0 and bundle_unique / expected < 0.9:
            flags.append("bundle_severely_partial_vs_archive")
        if int(item.get("unresolved_geometry_rows") or 0) > 0:
            flags.append("bundle_rows_without_geometry_join")
        registry = registry_rows.get(key, {})
        report_rows.append(
            {
                "consultation_key": key,
                "archive_election_type": str(item.get("election_type") or "camera"),
                "election_year": int(item["election_year"]),
                "archive_source_kind": "eligendo_opendata_zip",
                "archive_municipality_like_rows": expected,
                "archive_expected_bundle_rows": expected,
                "archive_positive_table_rows": expected,
                "archive_zero_table_rows": 0,
                "bundle_summary_rows": int(len(bundle_summary)),
                "bundle_unique_summary_municipalities": bundle_unique,
                "bundle_result_rows": int(len(bundle_results)),
                "bundle_registry_status": registry.get("status", ""),
                "bundle_registry_coverage_label": registry.get("coverage_label", ""),
                "graph_municipality_option_urls": 0,
                "graph_municipality_pages": 0,
                "summary_vs_archive_positive_ratio": ratio,
                "summary_vs_archive_municipality_ratio": ratio,
                "summary_vs_graph_option_ratio": None,
                "flags": flags,
            }
        )

    summary = {
        "rows": len(report_rows),
        "bundle_empty_archive_nonempty": sum(1 for row in report_rows if "bundle_empty_archive_nonempty" in row["flags"]),
        "bundle_below_archive_positive_tables": sum(1 for row in report_rows if "bundle_below_archive_positive_tables" in row["flags"]),
        "bundle_severely_partial_vs_archive": sum(1 for row in report_rows if "bundle_severely_partial_vs_archive" in row["flags"]),
        "with_any_flags": sum(1 for row in report_rows if row["flags"]),
    }
    target = output_root / "data" / "derived" / "archive_bundle_gap_report.json"
    write_json(
        target,
        {
            "generated_by": "rebuild_bundle_from_camera_opendata_archives.py",
            "source_file": "data/reference/camera_opendata_archives_manifest.json",
            "summary": summary,
            "rows": report_rows,
        },
    )

    manifest_path = output_root / "data" / "derived" / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.setdefault("files", {})["archiveBundleGapReport"] = "data/derived/archive_bundle_gap_report.json"
        notes = list((manifest.setdefault("project", {})).get("notes") or [])
        official_note = "Coverage diagnostics now compare the published bundle against the official Eligendo open-data zip archives."
        if official_note not in notes:
            notes.append(official_note)
        manifest["project"]["notes"] = notes
        write_json(manifest_path, manifest)

    data_products_path = output_root / "data" / "derived" / "data_products.json"
    if data_products_path.exists():
        data_products = json.loads(data_products_path.read_text(encoding="utf-8"))
        for product in data_products.get("products") or []:
            if product.get("product_key") == "metadata_layer":
                extras = list(product.get("extra_dataset_keys") or [])
                if "archiveBundleGapReport" not in extras:
                    extras.append("archiveBundleGapReport")
                product["extra_dataset_keys"] = extras
        write_json(data_products_path, data_products)

    provenance_path = output_root / "data" / "derived" / "provenance.json"
    if provenance_path.exists():
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        entries = provenance.get("entries") or []
        replacement = {
            "dataset_key": "archiveBundleGapReport",
            "path": "data/derived/archive_bundle_gap_report.json",
            "produced_by": "rebuild_bundle_from_camera_opendata_archives.py",
            "source_class": "coverage_diagnostics",
            "transformation_steps": [
                "derive official municipality coverage directly from the Eligendo open-data zip archives for Camera and Assemblea Costituente",
                "compare published summary coverage against the same official source",
                "carry the diagnostics into the static bundle as machine-readable metadata",
            ],
            "limitations": [
                "the report diagnoses residual gaps and unresolved geometry joins but does not harmonize extinct municipalities",
                "coverage equivalence with the official source does not imply full historical harmonization across boundary changes",
            ],
        }
        kept = [row for row in entries if row.get("dataset_key") != "archiveBundleGapReport"]
        kept.append(replacement)
        provenance["entries"] = kept
        write_json(provenance_path, provenance)


def normalize_official_party_rows_fast(turnout_rows: pd.DataFrame, party_rows: pd.DataFrame) -> pd.DataFrame:
    if party_rows.empty:
        return pd.DataFrame(columns=RESULT_COLUMNS)
    base = party_rows.copy()
    for col in ["votes", "election_year"]:
        base[col] = pd.to_numeric(base[col], errors="coerce")
    denom = (
        turnout_rows[["election_key", "municipality_id", "valid_votes", "voters"]]
        .drop_duplicates(subset=["election_key", "municipality_id"])
        .copy()
    )
    denom["valid_votes"] = pd.to_numeric(denom["valid_votes"], errors="coerce")
    denom["voters"] = pd.to_numeric(denom["voters"], errors="coerce")
    base = base.merge(denom, on=["election_key", "municipality_id"], how="left")
    party_sum = base.groupby(["election_key", "municipality_id"])["votes"].sum(min_count=1).rename("sum_party_votes").reset_index()
    base = base.merge(party_sum, on=["election_key", "municipality_id"], how="left")
    valid_ok = (
        base["valid_votes"].notna()
        & base["sum_party_votes"].notna()
        & (base["valid_votes"] > 0)
        & (base["sum_party_votes"] <= base["valid_votes"] * 1.05)
        & (base["sum_party_votes"] >= base["valid_votes"] * 0.5)
    )
    base["share_denominator"] = base["sum_party_votes"]
    base.loc[valid_ok, "share_denominator"] = base.loc[valid_ok, "valid_votes"]
    base["share_method"] = "share_recomputed_from_party_sum"
    base.loc[valid_ok, "share_method"] = "share_recomputed_from_valid_votes"
    base["vote_share"] = (base["votes"] / base["share_denominator"] * 100).where(base["share_denominator"].notna() & (base["share_denominator"] > 0))
    base["comparability_note"] = base.apply(
        lambda r: f"{r['comparability_note']}|{r['share_method']}" if str(r.get("comparability_note") or "").strip() else r["share_method"],
        axis=1,
    )
    base = base[base["vote_share"].notna() | base["votes"].notna()].copy()
    base["rank"] = base.groupby(["election_key", "municipality_id"])["vote_share"].rank(method="dense", ascending=False)
    return base[RESULT_COLUMNS]


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild the Camera/Costituente Explorer bundle from official Eligendo open-data zip archives.")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Path to camera_opendata_archives_manifest.json")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT), help="Root of lombardia_camera_app_v35")
    parser.add_argument("--scope", choices=["italy", "lombardia"], default="italy", help="Territorial scope to publish")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    output_root = Path(args.output_root).resolve()
    derived = output_root / "data" / "derived"
    derived.mkdir(parents=True, exist_ok=True)

    archive_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    archive_entries = sorted(
        archive_manifest.get("entries") or [],
        key=lambda row: (int(row["year"]), str(row.get("election_type") or "camera")),
    )
    preprocess.GEOMETRY_LOOKUP = preprocess.load_geometry_lookup(output_root / "data" / "reference")
    reference_year = max((int(entry["year"]) for entry in archive_entries), default=None)
    log_step(f"loading reference maps for scope={args.scope}")
    geometry_by_name_prov, geometry_by_name_region, geometry_by_name, master_by_name_prov, master_by_name_region, master_by_name = load_reference_maps(output_root, reference_year=reference_year)
    province_region_by_key = {
        normalize_lookup_key(record.get("province", "")): normalize_region_label(record.get("region", ""))
        for record in geometry_by_name_prov.values()
        if str(record.get("province") or "").strip() and str(record.get("region") or "").strip()
    }
    log_step("reference maps loaded")

    turnout_index: Dict[Tuple[str, str], Dict[str, object]] = {}
    turnout_segment_index: Dict[Tuple[str, str, str], Dict[str, Optional[int]]] = {}
    party_vote_index: Dict[Tuple[str, str, str], Dict[str, object]] = {}
    elections: List[Dict[str, object]] = []
    source_audit_rows: List[Dict[str, object]] = []
    reference_cache: Dict[Tuple[str, str, str], Tuple[Optional[Dict[str, str]], str]] = {}
    party_meta_cache: Dict[str, Dict[str, str]] = {}
    context_province_candidates: Dict[Tuple[str, str, str], set[str]] = {}

    for entry in archive_entries:
        year = int(entry["year"])
        election_type = str(entry.get("election_type") or "camera").strip().lower()
        election_key = consultation_key_for_entry(entry)
        election_date = iso_date_from_archive(str(entry.get("election_date") or ""))
        log_step(f"reading {election_key}")
        primary_member, rows = read_archive_rows(entry)
        log_step(f"processing {election_key}: {len(rows)} source rows")

        included_rows = 0
        unresolved_geometry_rows = 0
        municipality_ids: set[str] = set()

        for row in rows:
            province_raw = smart_title(first_nonempty(row, ["PROVINCIA"]))
            circ_raw = smart_title(first_nonempty(row, ["CIRCOSCRIZIONE", "CIRC-REG"]))
            region_raw = region_from_circ_raw(circ_raw)
            observed_name, municipality_name = canonical_observed_name(first_nonempty(row, ["COMUNE"]))
            if not municipality_name:
                continue
            segment_key = first_nonempty(row, ["COLLEGIOUNINOMINALE", "COLLUNINOM", "COLLEGIO", "COLLEGIOPLURINOMINALE", "COLLPLURI"]) or "__whole__"
            context_key = (election_key, normalize_lookup_key(circ_raw), normalize_lookup_key(segment_key))

            include_row = args.scope == "italy"
            if args.scope == "lombardia":
                if province_raw:
                    include_row = normalize_lookup_key(province_raw) in LOMBARDY_PROVINCES
                elif circ_raw:
                    include_row = "lombardia" in normalize_lookup_key(circ_raw)
            if not include_row:
                continue

            reference_key = (normalize_lookup_key(municipality_name), normalize_lookup_key(province_raw), normalize_lookup_key(region_raw))
            if reference_key in reference_cache:
                reference, resolution_method = reference_cache[reference_key]
            else:
                reference, resolution_method = resolve_reference(
                    municipality_name,
                    province_raw,
                    region_raw,
                    geometry_by_name_prov,
                    geometry_by_name_region,
                    geometry_by_name,
                    master_by_name_prov,
                    master_by_name_region,
                    master_by_name,
                )
                reference_cache[reference_key] = (reference, resolution_method)
            province = province_raw or smart_title((reference or {}).get("province", ""))
            region = normalize_region_label(
                str((reference or {}).get("region", ""))
                or region_raw
                or province_region_by_key.get(normalize_lookup_key(province), "")
                or ("Lombardia" if args.scope == "lombardia" else "")
            )
            municipality_id = str((reference or {}).get("municipality_id") or "").strip() or fallback_municipality_id(municipality_name, province)
            geometry_id = str((reference or {}).get("geometry_id") or "").strip()
            if province:
                context_province_candidates.setdefault(context_key, set()).add(province)

            notes = ["official_eligendo_opendata_zip"]
            if observed_name != municipality_name:
                notes.append("segment_aggregated_to_base_municipality")
            if province_raw == "" and province:
                notes.append("province_inferred_from_reference")
            if not geometry_id:
                notes.append("geometry_join_unresolved")
                unresolved_geometry_rows += 1

            electors = safe_int(first_nonempty(row, ["ELETTORI", "ELETTORITOT", "ELETTORITOTALI"]))
            voters = safe_int(first_nonempty(row, ["VOTANTI", "VOTANTITOT", "NUMVOTANTITOTALI"]))
            votes = safe_int(first_nonempty(row, ["VOTI_LISTA", "VOTILISTA"]))
            party_label = smart_title(first_nonempty(row, ["LISTA", "DESCRLISTA"]))

            turnout_key = (election_key, municipality_id)
            bucket = turnout_index.get(turnout_key)
            if bucket is None:
                bucket = {
                    "election_key": election_key,
                    "election_year": year,
                    "election_date": election_date,
                    "municipality_id": municipality_id,
                    "municipality_name": municipality_name,
                    "province": province,
                    "region": region,
                    "geometry_id": geometry_id,
                    "territorial_mode": "historical",
                    "territorial_status": "observed_opendata_zip",
                    "turnout_pct": None,
                    "electors": electors,
                    "voters": voters,
                    "valid_votes": None,
                    "total_votes": voters,
                    "comparability_note": "|".join(notes),
                    "completeness_flag": "official_opendata_turnout_and_lists",
                    "_context_key": context_key,
                }
                turnout_index[turnout_key] = bucket
            else:
                for field, value in (("electors", electors), ("voters", voters), ("total_votes", voters)):
                    if value is not None:
                        previous = bucket.get(field)
                        bucket[field] = value if previous in (None, "", 0) else max(int(previous), int(value))
                merged_notes = [part for part in str(bucket.get("comparability_note") or "").split("|") if part]
                for note in notes:
                    if note not in merged_notes:
                        merged_notes.append(note)
                bucket["comparability_note"] = "|".join(merged_notes)
                if not bucket.get("province") and province:
                    bucket["province"] = province
                if not bucket.get("geometry_id") and geometry_id:
                    bucket["geometry_id"] = geometry_id

            municipality_ids.add(municipality_id)
            included_rows += 1
            segment_bucket = turnout_segment_index.setdefault((election_key, municipality_id, segment_key), {"electors": electors, "voters": voters})
            for field, value in (("electors", electors), ("voters", voters)):
                if value is not None:
                    previous = segment_bucket.get(field)
                    segment_bucket[field] = value if previous in (None, "", 0) else max(int(previous), int(value))

            if votes is None or votes <= 0 or not party_label:
                continue
            meta = party_meta_cache.get(party_label)
            if meta is None:
                meta = preprocess.infer_party_meta(party_label)
                party_meta_cache[party_label] = meta
            party_key = (election_key, municipality_id, meta["display"])
            party_bucket = party_vote_index.get(party_key)
            if party_bucket is None:
                party_vote_index[party_key] = {
                    "election_key": election_key,
                    "election_year": year,
                    "election_date": election_date,
                    "municipality_id": municipality_id,
                    "municipality_name": municipality_name,
                    "province": province,
                    "region": region,
                    "party_raw": party_label,
                    "party_std": meta["display"],
                    "party_family": meta["family"],
                    "bloc": meta["bloc"],
                    "votes": votes,
                    "votes_raw_text": str(votes),
                    "vote_share_raw": None,
                    "territorial_mode": "historical",
                    "territorial_status": "observed_opendata_zip",
                    "geometry_id": geometry_id,
                    "comparability_note": "|".join(notes + ([resolution_method] if resolution_method else [])),
                    "_context_key": context_key,
                }
            else:
                party_bucket["votes"] = int(party_bucket.get("votes") or 0) + int(votes)
                party_bucket["votes_raw_text"] = str(party_bucket["votes"])
                merged_notes = [part for part in str(party_bucket.get("comparability_note") or "").split("|") if part]
                for note in notes + ([resolution_method] if resolution_method else []):
                    if note and note not in merged_notes:
                        merged_notes.append(note)
                party_bucket["comparability_note"] = "|".join(merged_notes)

        source_audit_rows.append(
            {
                "election_key": election_key,
                "election_type": election_type,
                "election_year": year,
                "election_date": election_date,
                "archive_filename": str(entry["filename"]),
                "primary_member": primary_member,
                "source_rows": len(rows),
                "scope": args.scope,
                "included_rows": included_rows,
                "lombardy_rows": included_rows if args.scope == "lombardia" else 0,
                "expected_bundle_rows": len(municipality_ids),
                "unresolved_geometry_rows": unresolved_geometry_rows,
            }
        )

        elections.append(
            {
                "election_key": election_key,
                "election_year": year,
                "election_date": election_date,
                "election_label": election_label_for_entry(entry),
                "electoral_system": electoral_system_for_entry(entry),
                "status": "completed",
                "is_complete": "true",
                "comparability_notes": f"official_eligendo_opendata_zip; election_type={election_type}; primary_member={primary_member}; unresolved_geometry_rows={unresolved_geometry_rows}",
                "source_notes": f"source=eligendo_opendata_zip; scope={args.scope}; election_type={election_type}; archive={entry['filename']}; primary_member={primary_member}; source_rows={len(rows)}; included_rows={included_rows}; unique_municipalities={len(municipality_ids)}",
            }
        )
        log_step(f"done {election_key}: included_rows={included_rows}, municipalities={len(municipality_ids)}, unresolved_geometry={unresolved_geometry_rows}")

    context_province_map = {key: next(iter(values)) for key, values in context_province_candidates.items() if len(values) == 1}
    for bucket in turnout_index.values():
        if not str(bucket.get("province") or "").strip():
            inferred = context_province_map.get(bucket.get("_context_key"))
            if inferred:
                bucket["province"] = inferred
                notes = [part for part in str(bucket.get("comparability_note") or "").split("|") if part]
                if "province_inferred_from_collegio_context" not in notes:
                    notes.append("province_inferred_from_collegio_context")
                bucket["comparability_note"] = "|".join(notes)
    for bucket in party_vote_index.values():
        if not str(bucket.get("province") or "").strip():
            inferred = context_province_map.get(bucket.get("_context_key"))
            if inferred:
                bucket["province"] = inferred
                notes = [part for part in str(bucket.get("comparability_note") or "").split("|") if part]
                if "province_inferred_from_collegio_context" not in notes:
                    notes.append("province_inferred_from_collegio_context")
                bucket["comparability_note"] = "|".join(notes)

    log_step("building turnout dataframe")
    turnout_rows = pd.DataFrame(turnout_index.values())
    if turnout_rows.empty:
        raise SystemExit(f"Nessuna riga {args.scope} trovata negli zip open data.")

    log_step("aggregating turnout segments")
    segment_totals: Dict[Tuple[str, str], Dict[str, int]] = {}
    for (election_key, municipality_id, _segment_key), values in turnout_segment_index.items():
        total = segment_totals.setdefault((election_key, municipality_id), {"electors": 0, "voters": 0})
        for field in ("electors", "voters"):
            value = values.get(field)
            if value is not None:
                total[field] += int(value)
    for key, bucket in turnout_index.items():
        totals = segment_totals.get(key)
        if totals:
            bucket["electors"] = totals["electors"] or None
            bucket["voters"] = totals["voters"] or None
            bucket["total_votes"] = totals["voters"] or bucket.get("total_votes")

    turnout_rows = pd.DataFrame(turnout_index.values())
    log_step(f"building party dataframe: party groups={len(party_vote_index)}")
    party_rows_raw_df = pd.DataFrame(party_vote_index.values())
    log_step("merging valid vote totals")
    valid_votes = (
        party_rows_raw_df.groupby(["election_key", "municipality_id"])["votes"].sum(min_count=1).reset_index(name="valid_votes")
        if not party_rows_raw_df.empty
        else pd.DataFrame(columns=["election_key", "municipality_id", "valid_votes"])
    )
    turnout_rows = turnout_rows.merge(valid_votes, on=["election_key", "municipality_id"], how="left", suffixes=("", "_sum"))
    turnout_rows["valid_votes"] = turnout_rows["valid_votes_sum"]
    turnout_rows = turnout_rows.drop(columns=["valid_votes_sum"], errors="ignore")
    turnout_rows["turnout_pct"] = turnout_rows.apply(
        lambda row: (row["voters"] / row["electors"] * 100) if pd.notna(row.get("voters")) and pd.notna(row.get("electors")) and row.get("electors") else None,
        axis=1,
    )
    turnout_rows["total_votes"] = turnout_rows["voters"].combine_first(turnout_rows["valid_votes"])
    turnout_error_mask = (
        turnout_rows["electors"].notna()
        & turnout_rows["voters"].notna()
        & (turnout_rows["electors"] < turnout_rows["voters"])
    ) | (
        turnout_rows["voters"].notna()
        & turnout_rows["valid_votes"].notna()
        & (turnout_rows["valid_votes"] > turnout_rows["voters"])
    )
    if turnout_error_mask.any():
        turnout_rows.loc[turnout_error_mask, "comparability_note"] = turnout_rows.loc[turnout_error_mask, "comparability_note"].apply(
            lambda note: "|".join(
                list(
                    dict.fromkeys(
                        [part for part in str(note or "").split("|") if part]
                        + ["official_turnout_counts_anomalous_nullified"]
                    )
                )
            )
        )
        turnout_rows.loc[turnout_error_mask, "electors"] = pd.NA
        turnout_rows.loc[turnout_error_mask, "voters"] = pd.NA
        turnout_rows.loc[turnout_error_mask, "turnout_pct"] = pd.NA
        turnout_rows.loc[turnout_error_mask, "total_votes"] = turnout_rows.loc[turnout_error_mask, "valid_votes"]

    if party_rows_raw_df.empty:
        party_rows = pd.DataFrame(columns=RESULT_COLUMNS)
    else:
        log_step("normalizing party rows")
        party_rows = normalize_official_party_rows_fast(turnout_rows.copy(), party_rows_raw_df.copy())

    log_step("building summary")
    summary_rows = preprocess.build_summary(turnout_rows.copy(), party_rows.copy())
    log_step("building master tables")
    municipalities, parties, lineage, aliases = preprocess.build_master_tables(summary_rows, party_rows, elections)
    log_step("finalizing elections and validations")
    elections = preprocess.finalize_elections_master(elections, summary_rows, party_rows)
    validations = preprocess.validate_derived(summary_rows, party_rows)

    total_elections = max(len(elections), 1)
    summary_covered = summary_rows["election_key"].nunique() if not summary_rows.empty else 0
    result_covered = party_rows["election_key"].nunique() if not party_rows.empty else 0
    validations["substantive_coverage_score"] = round(((summary_covered / total_elections) * 0.7 + (result_covered / total_elections) * 0.3) * 100)

    quality_payload = {
        "generated_by": "rebuild_bundle_from_camera_opendata_archives.py",
        "source_class": "official_eligendo_open_data_zip",
        "elections": source_audit_rows,
        "derived_validations": validations,
    }

    log_step("writing derived csv/json files")
    for filename, headers in preprocess.CONTRACTS.items():
        preprocess.ensure_contract_csv(derived / filename, headers)

    summary_rows.reindex(columns=SUMMARY_COLUMNS).to_csv(derived / "municipality_summary.csv", index=False)
    party_rows.reindex(columns=RESULT_COLUMNS).to_csv(derived / "municipality_results_long.csv", index=False)
    municipalities.reindex(columns=MASTER_COLUMNS).to_csv(derived / "municipalities_master.csv", index=False)
    parties.reindex(columns=PARTY_MASTER_COLUMNS).to_csv(derived / "parties_master.csv", index=False)
    lineage.reindex(columns=LINEAGE_COLUMNS).to_csv(derived / "territorial_lineage.csv", index=False)
    aliases.reindex(columns=ALIASES_COLUMNS).to_csv(derived / "municipality_aliases.csv", index=False)
    pd.DataFrame(elections).to_csv(derived / "elections_master.csv", index=False)
    write_json(derived / "data_quality_report.json", quality_payload)
    write_json(
        derived / "preprocess_log.json",
        {
            "generated_by": "rebuild_bundle_from_camera_opendata_archives.py",
            "source_manifest": str(manifest_path).replace("\\", "/"),
            "scope": args.scope,
            "source_rows": source_audit_rows,
            "validations": validations,
        },
    )

    log_step("writing shards, geometry pack, manifest and metadata")
    preprocess.write_results_long_shards(output_root, party_rows)
    preprocess.write_geometry_pack(output_root)
    preprocess.write_manifest(output_root)

    geometry_info = preprocess.geometry_manifest_files(output_root)
    dataset_registry = preprocess.build_dataset_registry(output_root, elections, summary_rows, party_rows, quality_payload)
    usage_notes = preprocess.build_usage_notes_payload(quality_payload, geometry_info)
    usage_notes.setdefault("notes", []).append(
        {
            "key": "official_opendata_source",
            "title": "Fonte primaria ufficiale",
            "severity": "info",
            "text": "I risultati comunali del bundle corrente derivano prioritariamente dagli zip open data ufficiali di Eligendo per la Camera e, per il 1946, per l'Assemblea Costituente. La navigazione HTML resta un supporto di QA e recupero, non la sorgente primaria.",
        }
    )
    write_json(derived / "dataset_registry.json", dataset_registry)
    write_json(derived / "usage_notes.json", usage_notes)

    build_gap_report(output_root, source_audit_rows, summary_rows, party_rows, dataset_registry)

    print(
        json.dumps(
            {
                "version": CURRENT_VERSION,
                "manifest": str(manifest_path),
                "summary_rows": int(len(summary_rows)),
                "result_rows": int(len(party_rows)),
                "municipalities_master_rows": int(len(municipalities)),
                "elections": len(elections),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
