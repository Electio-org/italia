#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import tempfile
from collections import Counter, defaultdict
from datetime import date, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from territorial_history import (
    CROSSWALK_COLUMNS,
    TARGET_GEOMETRY_DATE,
    TerritorialResolver,
    join_distinct,
    normalize_match_name,
    normalize_text,
    parse_iso_date,
    succession_events_from_rows,
    write_csv_gzip,
)
from election_sources import canonical_results_paths, canonical_summary_paths, publish_combined_elections_master


SITUAS_PUBLISH = "https://situas-servizi.istat.it/publish/reportspooljson"
ANPR_ARCHIVE = "https://www.confini-amministrativi.it/api/v2/it/archivio-storico-comuni.csv"
SOURCE_AS_OF = "2026-07-14"
MIN_HISTORY_DATE = date(1946, 1, 1)

EVENT_COLUMNS = [
    "report_id", "event_date", "event_code", "event_label", "source_code", "source_name",
    "source_province", "related_code", "related_name", "related_province", "legal_basis", "source_url",
]
REGISTRY_COLUMNS = [
    "election_key", "election_date", "istat_code", "name", "province", "province_sigla",
    "region", "cadastral_code", "source",
]
ANPR_COLUMNS = [
    "valid_from", "valid_to", "istat_code", "cadastral_code", "name", "alternate_name",
    "province_sigla", "status", "source",
]

EVENT_SPECS = {
    98: ("COD_VARIAZIONE", "Comuni soppressi o ceduti"),
    100: ("COD_VARIAZIONE_M", "Comuni costituiti o annessi"),
    103: ("COD_VARIAZIONE", "Variazioni territoriali"),
    104: ("", "Cambio denominazione"),
    105: ("COD_VARIAZIONE", "Variazione del codice statistico"),
}

# Conservative spelling corrections observed in official election exports. These
# never assign a target directly: they only improve matching against a dated registry.
NAME_CORRECTIONS = {
    "cerretto delle langhe": "cerreto delle langhe",
    "ro ferrarese": "ro",
    "bastia": "bastia umbra",
    "paganico": "civitella paganico",
}


def repair_text(value: object) -> str:
    text = str(value or "").strip()
    if any(marker in text for marker in ("Ã", "Â", "â")):
        try:
            text = text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return text


def source_name_key(value: object) -> str:
    key = normalize_match_name(repair_text(value))
    return NAME_CORRECTIONS.get(key, key)


def name_variants(value: object) -> set[str]:
    text = repair_text(value)
    variants = {source_name_key(text)}
    if "/" in text:
        variants.add(source_name_key(text.split("/", 1)[0]))
    if "-" in text:
        variants.add(source_name_key(text.rsplit("-", 1)[0]))
    return {variant for variant in variants if variant}


def names_compatible(source: object, candidate: object) -> bool:
    candidate_key = source_name_key(candidate)
    source_compact = normalize_text(source).replace(" ", "")
    candidate_compact = normalize_text(candidate).replace(" ", "")
    candidate_tokens = set(candidate_key.split())
    for source_key in name_variants(source):
        source_tokens = set(source_key.split())
        if source_key == candidate_key or source_key.replace(" ", "") == candidate_key.replace(" ", ""):
            return True
        if min(len(source_compact), len(candidate_compact)) >= 6 and (
            source_compact in candidate_compact or candidate_compact in source_compact
        ):
            return True
        if source_tokens and candidate_tokens and (source_tokens <= candidate_tokens or candidate_tokens <= source_tokens):
            return True
        if min(len(source_key), len(candidate_key)) >= 6 and SequenceMatcher(None, source_key, candidate_key).ratio() >= 0.9:
            return True
    return False


def six_digit_code(value: object) -> str:
    raw = str(value or "").strip()
    return raw.zfill(6) if raw.isdigit() and len(raw) <= 6 else raw


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "Electio-Italia territorial-history builder/1.0"})
    with urlopen(request, timeout=120) as response:
        return response.read()


def fetch_situas(report_id: int, *, on_date: date | None = None) -> List[Dict[str, object]]:
    if on_date:
        params = {"pfun": report_id, "pdata": on_date.strftime("%d/%m/%Y")}
    elif report_id == 129:
        params = {"pfun": report_id, "pdata": TARGET_GEOMETRY_DATE.strftime("%d/%m/%Y")}
    else:
        params = {
            "pfun": report_id,
            "pdatada": "17/03/1861",
            "pdataa": TARGET_GEOMETRY_DATE.strftime("%d/%m/%Y"),
        }
    payload = json.loads(fetch_bytes(f"{SITUAS_PUBLISH}?{urlencode(params)}").decode("utf-8"), strict=False)
    return list(payload.get("resultset") or payload.get("items") or [])


def iter_csv_rows(path: Path):
    opener = gzip.open if path.suffix == ".gz" else path.open
    with opener(path, "rt", encoding="utf-8-sig", newline="") if path.suffix == ".gz" else opener(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def read_csv_rows(path: Path) -> List[Dict[str, str]]:
    return list(iter_csv_rows(path))


def read_json_rows(path: Path) -> List[Dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"), strict=False)
    return list(payload.get("resultset") or payload.get("items") or [])


def write_csv(path: Path, rows: Iterable[Mapping[str, object]], columns: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})


def load_elections(derived: Path) -> List[Dict[str, str]]:
    return publish_combined_elections_master(derived)


def load_targets(derived: Path) -> Dict[str, Dict[str, str]]:
    path = derived / "geometries_web" / "municipalities_2021.topojson"
    payload = json.loads(path.read_text(encoding="utf-8"))
    objects = payload.get("objects") or {}
    first = next(iter(objects.values()), {})
    targets = {}
    for geometry in first.get("geometries") or []:
        props = geometry.get("properties") or {}
        code = six_digit_code(props.get("geometry_id") or props.get("municipality_id"))
        if not re.fullmatch(r"\d{6}", code):
            continue
        targets[code] = {
            "geometry_id": code,
            "name": repair_text(props.get("name_current") or props.get("name")),
            "province": repair_text(props.get("province")),
            "province_code": str(props.get("province_code") or ""),
            "region": repair_text(props.get("region")),
        }
    if len(targets) < 7_800:
        raise RuntimeError(f"Geometria target 2021 incompleta: {len(targets)} comuni")
    return targets


def compact_anpr_rows(raw_rows: Iterable[Mapping[str, object]]) -> List[Dict[str, str]]:
    rows = []
    for raw in raw_rows:
        valid_from = str(raw.get("DATAISTITUZIONE") or "")[:10]
        valid_to = str(raw.get("DATACESSAZIONE") or "")[:10]
        if not valid_from or not valid_to:
            continue
        start = parse_iso_date(valid_from)
        end = parse_iso_date(valid_to)
        if not start or not end or start > TARGET_GEOMETRY_DATE or end < MIN_HISTORY_DATE:
            continue
        code = six_digit_code(raw.get("CODISTAT"))
        if not re.fullmatch(r"\d{6}", code):
            continue
        rows.append({
            "valid_from": valid_from,
            "valid_to": valid_to,
            "istat_code": code,
            "cadastral_code": repair_text(raw.get("CODCATASTALE")),
            "name": repair_text(raw.get("DENOMINAZIONE_IT")),
            "alternate_name": repair_text(raw.get("ALTRADENOMINAZIONE")),
            "province_sigla": repair_text(raw.get("SIGLAPROVINCIA")),
            "status": repair_text(raw.get("STATO")),
            "source": "ANPR historical archive via OnData",
        })
    return sorted(rows, key=lambda row: (row["istat_code"], row["valid_from"], row["name"]))


def ensure_anpr_reference(root: Path, refresh: bool) -> List[Dict[str, str]]:
    path = root / "data" / "reference" / "municipality_registry_historical_anpr.csv.gz"
    if path.exists() and not refresh:
        return read_csv_rows(path)

    temp_source = Path(tempfile.gettempdir()) / "ondata_archivio_storico_comuni.csv"
    if refresh or not temp_source.exists():
        temp_source.write_bytes(fetch_bytes(ANPR_ARCHIVE))
    raw_rows = read_csv_rows(temp_source)
    rows = compact_anpr_rows(raw_rows)
    write_csv_gzip(path, rows, ANPR_COLUMNS)
    return rows


def normalized_event_rows(report_rows: Mapping[int, List[Mapping[str, object]]]) -> List[Dict[str, str]]:
    legal_by_key: Dict[tuple, str] = {}
    for row in report_rows.get(129, []):
        event_date = str(row.get("DATA_INIZIO_AMMINISTRATIVA") or "")[:10]
        key = (
            event_date,
            six_digit_code(row.get("PRO_COM_T")),
            six_digit_code(row.get("PRO_COM_T_REL")),
        )
        legal_by_key[key] = join_distinct([row.get("PROVVEDIMENTO"), row.get("TESTO_PROVVEDIMENTO")], " | ")

    events = []
    for report_id, (code_field, label) in EVENT_SPECS.items():
        for row in report_rows.get(report_id, []):
            event_date = str(row.get("DATA_INIZIO_AMMINISTRATIVA") or "")[:10]
            parsed = parse_iso_date(event_date)
            if not parsed or parsed > TARGET_GEOMETRY_DATE:
                continue
            source_code = six_digit_code(row.get("PRO_COM_T"))
            related_code = six_digit_code(row.get("PRO_COM_T_REL"))
            event_code = repair_text(row.get(code_field)) if code_field else "CD"
            key = (event_date, source_code, related_code)
            events.append({
                "report_id": report_id,
                "event_date": event_date,
                "event_code": event_code.upper(),
                "event_label": label,
                "source_code": source_code,
                "source_name": repair_text(row.get("COMUNE")),
                "source_province": repair_text(row.get("SIGLA_UTS") or row.get("SIGLA_AUTOMOBILISTICA")),
                "related_code": related_code,
                "related_name": repair_text(row.get("COMUNE_REL")),
                "related_province": repair_text(row.get("SIGLA_UTS_REL") or row.get("SIGLA_AUTOMOBILISTICA_REL")),
                "legal_basis": legal_by_key.get(key, ""),
                "source_url": f"{SITUAS_PUBLISH}?pfun={report_id}",
            })
    deduped = {tuple(row[column] for column in EVENT_COLUMNS[:-1]): row for row in events}
    return sorted(deduped.values(), key=lambda row: (row["event_date"], row["source_code"], row["event_code"], row["related_code"]))


def ensure_event_reference(root: Path, refresh: bool) -> List[Dict[str, str]]:
    path = root / "data" / "reference" / "situas_municipality_events_1861_2021.csv.gz"
    if path.exists() and not refresh:
        return read_csv_rows(path)

    report_rows: Dict[int, List[Mapping[str, object]]] = {}
    for report_id in [98, 100, 103, 104, 105, 129]:
        temp_source = Path(tempfile.gettempdir()) / f"situas_{report_id}.csv"
        if not refresh and temp_source.exists():
            report_rows[report_id] = read_csv_rows(temp_source)
        else:
            report_rows[report_id] = fetch_situas(report_id)
    rows = normalized_event_rows(report_rows)
    write_csv_gzip(path, rows, EVENT_COLUMNS)
    return rows


def compact_snapshot(election: Mapping[str, str], raw_rows: Iterable[Mapping[str, object]]) -> List[Dict[str, str]]:
    compact = []
    for raw in raw_rows:
        code = six_digit_code(raw.get("PRO_COM_T"))
        if not re.fullmatch(r"\d{6}", code):
            continue
        compact.append({
            "election_key": election["election_key"],
            "election_date": election["election_date"],
            "istat_code": code,
            "name": repair_text(raw.get("COMUNE_IT") or raw.get("COMUNE")),
            "province": repair_text(raw.get("DEN_UTS")),
            "province_sigla": repair_text(raw.get("SIGLA_AUTOMOBILISTICA")),
            "region": repair_text(raw.get("DEN_REG")),
            "cadastral_code": repair_text(raw.get("COD_CATASTO")),
            "source": "ISTAT SITUAS report 61",
        })
    return compact


def anpr_active_snapshot(election: Mapping[str, str], anpr_rows: Iterable[Mapping[str, str]]) -> List[Dict[str, str]]:
    election_date = date.fromisoformat(election["election_date"])
    rows = []
    for raw in anpr_rows:
        start = parse_iso_date(raw.get("valid_from"))
        end = parse_iso_date(raw.get("valid_to"))
        if not start or not end or not (start <= election_date <= end):
            continue
        rows.append({
            "election_key": election["election_key"],
            "election_date": election["election_date"],
            "istat_code": raw["istat_code"],
            "name": raw["name"],
            "province": "",
            "province_sigla": raw.get("province_sigla", ""),
            "region": "",
            "cadastral_code": raw.get("cadastral_code", ""),
            "source": "ANPR historical archive via OnData (dated registry fallback)",
        })
    return rows


def ensure_registry_reference(
    root: Path,
    elections: Sequence[Mapping[str, str]],
    anpr_rows: Sequence[Mapping[str, str]],
    refresh: bool,
) -> List[Dict[str, str]]:
    path = root / "data" / "reference" / "municipality_registry_by_election.csv.gz"
    if path.exists() and not refresh:
        existing = read_csv_rows(path)
        present = {row.get("election_key") for row in existing}
        missing = [election for election in elections if election.get("election_key") not in present]
        if not missing:
            return existing
        rows = list(existing)
        for election in missing:
            rows.extend(anpr_active_snapshot(election, anpr_rows))
        rows.sort(key=lambda row: (row["election_date"], row["istat_code"]))
        write_csv_gzip(path, rows, REGISTRY_COLUMNS)
        return rows

    rows = []
    cache_dir = Path(tempfile.gettempdir()) / "electio_situas_snapshots"
    for election in elections:
        election_date = date.fromisoformat(election["election_date"])
        if election_date < date(1948, 1, 1):
            rows.extend(anpr_active_snapshot(election, anpr_rows))
            continue
        cached = cache_dir / f"{election['election_key']}.json"
        if not refresh and cached.exists():
            raw_rows = read_json_rows(cached)
        else:
            raw_rows = fetch_situas(61, on_date=election_date)
        rows.extend(compact_snapshot(election, raw_rows))
    rows.sort(key=lambda row: (row["election_date"], row["istat_code"]))
    write_csv_gzip(path, rows, REGISTRY_COLUMNS)
    return rows


def province_matches(source: str, row: Mapping[str, str]) -> bool:
    source_key = normalize_text(source)
    if not source_key:
        return True
    province = repair_text(row.get("province"))
    values = {
        normalize_text(province),
        normalize_text(province.split("/", 1)[0]),
        normalize_text(row.get("province_sigla")),
    }
    return source_key in values


def choose_unique(candidates: Iterable[Mapping[str, str]], source_province: str, source_id: str) -> Mapping[str, str] | None:
    candidates = list(candidates)
    province_filtered = [row for row in candidates if province_matches(source_province, row)]
    pool = province_filtered or candidates
    codes = {row["istat_code"] for row in pool}
    if len(codes) == 1:
        return pool[0]
    source_code = six_digit_code(source_id)
    code_matches = [row for row in pool if row["istat_code"] == source_code]
    return code_matches[0] if len(code_matches) == 1 else None


def build_registry_indexes(rows: Iterable[Mapping[str, str]]) -> Dict[str, Dict[str, object]]:
    by_election: Dict[str, Dict[str, object]] = {}
    grouped: Dict[str, List[Mapping[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[row["election_key"]].append(row)
    for election_key, items in grouped.items():
        by_name: Dict[str, list] = defaultdict(list)
        by_code: Dict[str, Mapping[str, str]] = {}
        for item in items:
            by_name[source_name_key(item["name"])].append(item)
            by_code[item["istat_code"]] = item
        by_election[election_key] = {"rows": items, "by_name": by_name, "by_code": by_code}
    return by_election


def build_historical_indexes(rows: Sequence[Mapping[str, str]]) -> Dict[str, list]:
    by_name: Dict[str, list] = defaultdict(list)
    for row in rows:
        for name in [row.get("name"), row.get("alternate_name")]:
            key = source_name_key(name)
            if key:
                by_name[key].append(row)
    return by_name


def fuzzy_registry_match(name: str, province: str, registry: Mapping[str, object]) -> Mapping[str, str] | None:
    source_key = source_name_key(name)
    if len(source_key) < 6:
        return None
    candidates = [row for row in registry["rows"] if province_matches(province, row)]
    if not candidates:
        candidates = list(registry["rows"])
    scored = []
    for row in candidates:
        candidate_key = source_name_key(row["name"])
        if candidate_key[:1] != source_key[:1]:
            continue
        if abs(len(candidate_key) - len(source_key)) > 3 and not names_compatible(name, row["name"]):
            continue
        ratio = 1.0 if names_compatible(name, row["name"]) else SequenceMatcher(None, source_key, candidate_key).ratio()
        if ratio >= 0.9:
            scored.append((ratio, row["istat_code"], row))
    scored.sort(key=lambda item: (-item[0], item[1]))
    if not scored or (len(scored) > 1 and scored[0][0] - scored[1][0] < 0.04 and scored[0][1] != scored[1][1]):
        return None
    return scored[0][2]


def historical_fallback(
    name: str,
    province: str,
    election_date: date,
    historical_by_name: Mapping[str, list],
) -> Mapping[str, str] | None:
    candidates = []
    for variant in name_variants(name):
        candidates.extend(historical_by_name.get(variant, []))
    province_filtered = [row for row in candidates if province_matches(province, row)]
    pool = province_filtered or candidates
    eligible = []
    for row in pool:
        end = parse_iso_date(row.get("valid_to"))
        if end and end < election_date:
            eligible.append((end, row["istat_code"], row))
    eligible.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if not eligible:
        return None
    nearest_date = eligible[0][0]
    nearest = [item[2] for item in eligible if item[0] == nearest_date]
    return nearest[0] if len({row["istat_code"] for row in nearest}) == 1 else None


def target_name_index(targets: Mapping[str, Mapping[str, str]]) -> Dict[str, list]:
    index: Dict[str, list] = defaultdict(list)
    for code, target in targets.items():
        index[source_name_key(target["name"])].append({"istat_code": code, **target})
    return index


def build_crosswalk(
    derived: Path,
    elections: Sequence[Mapping[str, str]],
    registry_rows: Sequence[Mapping[str, str]],
    anpr_rows: Sequence[Mapping[str, str]],
    resolver: TerritorialResolver,
    targets: Mapping[str, Mapping[str, str]],
) -> tuple[List[Dict[str, str]], Dict[str, object]]:
    election_dates = {row["election_key"]: date.fromisoformat(row["election_date"]) for row in elections}
    registry_by_election = build_registry_indexes(registry_rows)
    historical_by_name = build_historical_indexes(anpr_rows)
    target_by_name = target_name_index(targets)

    source_rows = []
    seen = set()
    for source_path in [*canonical_summary_paths(derived), *canonical_results_paths(derived)]:
        for row in iter_csv_rows(source_path):
            key = (row.get("election_key", ""), row.get("municipality_id", ""))
            if key in seen:
                continue
            seen.add(key)
            source_rows.append({
                "election_key": row.get("election_key", ""),
                "municipality_id": row.get("municipality_id", ""),
                "municipality_name": row.get("municipality_name", ""),
                "province": row.get("province", ""),
                "region": row.get("region", ""),
            })

    crosswalk = []
    coverage: Dict[str, Counter] = defaultdict(Counter)
    exceptions: Dict[str, Dict[str, list]] = defaultdict(lambda: {"ambiguous": [], "unresolved": []})
    for source in source_rows:
        election_key = source["election_key"]
        election_date = election_dates[election_key]
        registry = registry_by_election.get(election_key, {"rows": [], "by_name": {}, "by_code": {}})
        source_id = source.get("municipality_id", "")
        source_name = repair_text(source.get("municipality_name"))
        source_province = repair_text(source.get("province"))
        source_region = repair_text(source.get("region"))
        historical_code = ""
        resolution_date = election_date
        method = ""
        confidence = ""

        source_code = six_digit_code(source_id)
        code_match = registry["by_code"].get(source_code)
        code_region_matches = bool(
            code_match
            and source_region
            and normalize_text(source_region) == normalize_text(code_match.get("region"))
        )
        corrupted_label = bool(
            code_region_matches
            and not names_compatible(source_name, code_match.get("name"))
            and not province_matches(source_province, code_match)
        )
        if corrupted_label:
            historical_code = source_code
            method = "dated_registry_code_repaired_label"
            confidence = "high"
        else:
            exact_candidates = []
            for variant in name_variants(source_name):
                exact_candidates.extend(registry["by_name"].get(variant, []))
            match = choose_unique(exact_candidates, source_province, source_id)
            if match:
                historical_code = match["istat_code"]
                method = "dated_registry_name"
                confidence = "high"
            else:
                compatible_code_name = names_compatible(source_name, code_match["name"]) if code_match else False
                damaged_source_label = "+" in source_name and source_code in targets
                if code_match and (
                    (province_matches(source_province, code_match) and compatible_code_name)
                    or damaged_source_label
                ):
                    historical_code = source_code
                    method = "dated_registry_code_compatible_name"
                    confidence = "high"
                else:
                    fuzzy = fuzzy_registry_match(source_name, source_province, registry)
                    if fuzzy:
                        historical_code = fuzzy["istat_code"]
                        method = "dated_registry_conservative_spelling"
                        confidence = "medium"

        if not historical_code:
            old = historical_fallback(source_name, source_province, election_date, historical_by_name)
            if old:
                historical_code = old["istat_code"]
                valid_to = parse_iso_date(old.get("valid_to"))
                resolution_date = min(election_date, valid_to) if valid_to else election_date
                method = "historical_registry_nearest_predecessor"
                confidence = "medium"

        resolution = resolver.resolve(historical_code, resolution_date) if historical_code else None
        targets_found = list(resolution.targets) if resolution else []
        lineage_paths = list(resolution.paths) if resolution else []

        if not targets_found:
            direct_candidates = []
            for variant in name_variants(source_name):
                direct_candidates.extend(target_by_name.get(variant, []))
            direct = choose_unique(direct_candidates, source_province, source_id)
            if direct:
                targets_found = [direct["istat_code"]]
                lineage_paths = [direct["istat_code"]]
                historical_code = historical_code or direct["istat_code"]
                method = method or "direct_2021_name"
                confidence = confidence or "medium"

        if len(targets_found) == 1:
            target_id = targets_found[0]
            target = targets[target_id]
            status = "resolved"
            coverage[election_key]["resolved"] += 1
            coverage[election_key][method] += 1
        elif len(targets_found) > 1:
            target_id = ""
            target = {}
            status = "ambiguous_split"
            confidence = "none"
            coverage[election_key]["ambiguous_split"] += 1
        else:
            target_id = ""
            target = {}
            status = "unresolved"
            confidence = "none"
            coverage[election_key]["unresolved"] += 1

        coverage[election_key]["source_rows"] += 1
        output = {
            "election_key": election_key,
            "election_date": election_date.isoformat(),
            "source_municipality_id": source_id,
            "source_name": source_name,
            "source_province": source_province,
            "source_region": source_region,
            "historical_istat_code": historical_code,
            "target_geometry_id": target_id,
            "target_name": target.get("name", ""),
            "target_province": target.get("province", ""),
            "target_region": target.get("region", ""),
            "resolution_method": method,
            "confidence": confidence,
            "status": status,
            "lineage_path": "|".join(lineage_paths),
        }
        crosswalk.append(output)
        if status != "resolved" and len(exceptions[election_key]["ambiguous" if targets_found else "unresolved"]) < 30:
            exceptions[election_key]["ambiguous" if targets_found else "unresolved"].append(output)

    crosswalk.sort(key=lambda row: (row["election_date"], row["source_name"], row["source_municipality_id"]))
    report_elections = []
    for election in elections:
        key = election["election_key"]
        stats = coverage[key]
        total = stats["source_rows"]
        report_elections.append({
            "election_key": key,
            "election_date": election["election_date"],
            "source_municipalities": total,
            "resolved_municipalities": stats["resolved"],
            "coverage_pct": round(stats["resolved"] / total * 100, 4) if total else 0,
            "ambiguous_splits": stats["ambiguous_split"],
            "unresolved": stats["unresolved"],
            "methods": {name: count for name, count in sorted(stats.items()) if name not in {"source_rows", "resolved", "ambiguous_split", "unresolved"}},
            "exception_samples": exceptions[key],
        })
    report = {
        "generated_by": "build_territorial_history.py",
        "target_geometry_date": TARGET_GEOMETRY_DATE.isoformat(),
        "target_municipalities": len(targets),
        "policy": {
            "public_projection": "I predecessori completi vengono aggregati sulla geometria comunale 2021.",
            "source_registry": "Le identità comunali sono ricavate dall'unione dei riepiloghi e dei risultati per partito.",
            "partial_transfers": "I trasferimenti parziali non vengono allocati senza una chiave ufficiale dei voti.",
            "ambiguous_splits": "Le scissioni ambigue sono escluse dagli shard pubblici proiettati e dichiarate nel report.",
        },
        "elections": report_elections,
    }
    return crosswalk, report


def resolved_target_for_version(row: Mapping[str, str], resolver: TerritorialResolver) -> str:
    start = parse_iso_date(row.get("valid_from")) or MIN_HISTORY_DATE
    end = parse_iso_date(row.get("valid_to")) or TARGET_GEOMETRY_DATE
    cursor = max(start, MIN_HISTORY_DATE)
    if end < TARGET_GEOMETRY_DATE:
        cursor = min(cursor, end)
    resolution = resolver.resolve(row.get("istat_code", ""), cursor)
    return resolution.targets[0] if len(resolution.targets) == 1 else ""


def build_aliases_and_lineage(
    targets: Mapping[str, Mapping[str, str]],
    anpr_rows: Sequence[Mapping[str, str]],
    event_rows: Sequence[Mapping[str, str]],
    crosswalk: Sequence[Mapping[str, str]],
    resolver: TerritorialResolver,
) -> tuple[List[Dict[str, str]], List[Dict[str, str]], List[Dict[str, str]]]:
    aliases: Dict[str, Dict[str, Dict[str, object]]] = defaultdict(dict)
    predecessor_codes: Dict[str, set] = defaultdict(set)
    provinces: Dict[str, set] = defaultdict(set)
    valid_froms: Dict[str, list] = defaultdict(list)
    event_codes: Dict[str, set] = defaultdict(set)
    merge_events: Dict[str, set] = defaultdict(set)
    rename_events: Dict[str, set] = defaultdict(set)

    def add_alias(target_id: str, alias: str, alias_type: str, valid_from: str = "", valid_to: str = "", notes: str = "") -> None:
        alias = repair_text(alias)
        key = normalize_text(alias)
        if not target_id or not key:
            return
        current = aliases[target_id].get(key)
        priority = {"current_name": 0, "historical_name": 1, "alternate_name": 2, "election_source_name": 3}
        candidate = {
            "alias": alias,
            "alias_type": alias_type,
            "valid_from": valid_from,
            "valid_to": valid_to,
            "notes": notes,
        }
        if current is None or priority.get(alias_type, 9) < priority.get(str(current["alias_type"]), 9):
            aliases[target_id][key] = candidate

    for target_id, target in targets.items():
        add_alias(target_id, target["name"], "current_name", "", TARGET_GEOMETRY_DATE.isoformat(), "ISTAT geometry 2021")
        provinces[target_id].add(target["province"])

    version_targets: Dict[tuple, str] = {}
    for row in anpr_rows:
        target_id = resolved_target_for_version(row, resolver)
        version_targets[(row["istat_code"], row["valid_from"], row["name"])] = target_id
        if not target_id:
            continue
        predecessor_codes[target_id].add(row["istat_code"])
        provinces[target_id].add(row.get("province_sigla", ""))
        start = parse_iso_date(row.get("valid_from"))
        if start:
            valid_froms[target_id].append(start)
        add_alias(target_id, row.get("name", ""), "historical_name", row.get("valid_from", ""), row.get("valid_to", ""), "ANPR historical archive")
        add_alias(target_id, row.get("alternate_name", ""), "alternate_name", row.get("valid_from", ""), row.get("valid_to", ""), "ANPR historical archive")

    for row in event_rows:
        event_date = parse_iso_date(row.get("event_date")) or MIN_HISTORY_DATE
        candidates = []
        for code, name in [(row.get("source_code", ""), row.get("source_name", "")), (row.get("related_code", ""), row.get("related_name", ""))]:
            resolution = resolver.resolve(code, min(event_date, TARGET_GEOMETRY_DATE))
            if len(resolution.targets) == 1:
                candidates.append((resolution.targets[0], name))
        for target_id, name in candidates:
            add_alias(target_id, name, "historical_name", "", row.get("event_date", ""), f"ISTAT SITUAS report {row.get('report_id')}")
            event_codes[target_id].add(row.get("event_code", ""))
            if row.get("event_code") == "ES":
                merge_events[target_id].add(row.get("event_date", ""))
            if row.get("event_code") == "CD":
                rename_events[target_id].add(row.get("event_date", ""))

    for row in crosswalk:
        if row.get("status") == "resolved" and row.get("resolution_method") != "dated_registry_code_repaired_label":
            add_alias(
                row["target_geometry_id"], row.get("source_name", ""), "election_source_name",
                row.get("election_date", ""), row.get("election_date", ""), "official election source label",
            )

    alias_rows = []
    lineage_rows = []
    master_rows = []
    for target_id, target in sorted(targets.items()):
        target_aliases = sorted(aliases[target_id].values(), key=lambda row: (normalize_text(row["alias"]), row["alias_type"]))
        for alias in target_aliases:
            alias_rows.append({"municipality_id": target_id, **alias})
        historical_names = [row["alias"] for row in target_aliases if row["alias_type"] != "current_name" and normalize_text(row["alias"]) != normalize_text(target["name"])]
        parent_ids = sorted(code for code in predecessor_codes[target_id] if code != target_id)
        earliest = min(valid_froms[target_id]).isoformat() if valid_froms[target_id] else ""
        lineage_rows.append({
            "municipality_id_stable": target_id,
            "name_current": target["name"],
            "name_historical": join_distinct(historical_names),
            "valid_from": earliest,
            "valid_to": TARGET_GEOMETRY_DATE.isoformat(),
            "parent_ids": "|".join(parent_ids),
            "child_ids": "",
            "event_type": "|".join(sorted(code for code in event_codes[target_id] if code)),
            "merge_event": "|".join(sorted(date_value for date_value in merge_events[target_id] if date_value)),
            "split_event": "",
            "rename_event": "|".join(sorted(date_value for date_value in rename_events[target_id] if date_value)),
            "province_history": "|".join(sorted(value for value in provinces[target_id] if value)),
            "geometry_strategy": "complete_predecessors_projected_to_2021_geometry",
            "notes": "Date-aware SITUAS succession; ambiguous splits and partial transfers are not allocated.",
        })
        master_rows.append({
            "municipality_id": target_id,
            "name_current": target["name"],
            "name_historical": join_distinct(historical_names),
            "province_current": target["province"],
            "province_code_current": target["province_code"],
            "region": target["region"],
            "geometry_id": target_id,
            "valid_from": earliest,
            "valid_to": TARGET_GEOMETRY_DATE.isoformat(),
            "active_current": "true",
            "source_status": "istat_situas_anpr_harmonized_2021",
            "alias_names": join_distinct([row["alias"] for row in target_aliases]),
            "lineage_note": f"{len(parent_ids)} predecessor code(s); date-aware projection to 2021 geometry",
            "harmonized_group_id": target_id,
        })
    return master_rows, alias_rows, lineage_rows


def write_source_metadata(root: Path, report: Mapping[str, object]) -> None:
    payload = {
        "generated_by": "build_territorial_history.py",
        "retrieved_on": SOURCE_AS_OF,
        "target_geometry_date": TARGET_GEOMETRY_DATE.isoformat(),
        "sources": [
            {
                "name": "ISTAT SITUAS",
                "role": "Snapshot comunali datati ed eventi ufficiali di successione amministrativa.",
                "url": "https://situas.istat.it/",
                "reports": [61, 98, 100, 103, 104, 105, 129],
            },
            {
                "name": "Archivio storico dei comuni ANPR via OnData",
                "role": "Registro integrativo per il 1946, denominazioni storiche e intervalli di validità.",
                "url": ANPR_ARCHIVE,
                "caveat": "Distribuzione secondaria di dati anagrafici ANPR/ISTAT; SITUAS resta la fonte primaria per le successioni.",
            },
        ],
        "method": report.get("policy"),
    }
    path = root / "data" / "reference" / "territorial_sources.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the date-aware municipality lineage and election-to-2021 crosswalk.")
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--refresh-sources", action="store_true", help="Refresh compact source snapshots from SITUAS and OnData")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    derived = root / "data" / "derived"
    elections = load_elections(derived)
    targets = load_targets(derived)
    anpr_rows = ensure_anpr_reference(root, args.refresh_sources)
    event_rows = ensure_event_reference(root, args.refresh_sources)
    registry_rows = ensure_registry_reference(root, elections, anpr_rows, args.refresh_sources)
    resolver = TerritorialResolver(targets, succession_events_from_rows(event_rows))

    crosswalk, report = build_crosswalk(derived, elections, registry_rows, anpr_rows, resolver, targets)
    master, aliases, lineage = build_aliases_and_lineage(targets, anpr_rows, event_rows, crosswalk, resolver)

    write_csv_gzip(derived / "municipality_election_crosswalk.csv.gz", crosswalk, CROSSWALK_COLUMNS)
    write_csv(derived / "municipalities_master.csv", master, [
        "municipality_id", "name_current", "name_historical", "province_current", "province_code_current",
        "region", "geometry_id", "valid_from", "valid_to", "active_current", "source_status", "alias_names",
        "lineage_note", "harmonized_group_id",
    ])
    write_csv(derived / "municipality_aliases.csv", aliases, ["municipality_id", "alias", "alias_type", "valid_from", "valid_to", "notes"])
    write_csv(derived / "territorial_lineage.csv", lineage, [
        "municipality_id_stable", "name_current", "name_historical", "valid_from", "valid_to", "parent_ids",
        "child_ids", "event_type", "merge_event", "split_event", "rename_event", "province_history",
        "geometry_strategy", "notes",
    ])
    (derived / "territorial_history_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_source_metadata(root, report)

    resolved = sum(row["status"] == "resolved" for row in crosswalk)
    print(json.dumps({
        "target_municipalities": len(targets),
        "crosswalk_rows": len(crosswalk),
        "resolved_rows": resolved,
        "coverage_pct": round(resolved / len(crosswalk) * 100, 4),
        "aliases": len(aliases),
        "lineage_rows": len(lineage),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
