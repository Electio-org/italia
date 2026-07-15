#!/usr/bin/env python3
"""Build canonical municipality-level European-election source tables.

The official Ministry archives stay outside Git. This script extracts only the
municipality result member from every European election archive and publishes
small, reproducible gzip sources consumed by the common Electio pipeline.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import sys
import unicodedata
import zipfile
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import preprocess
from election_sources import publish_combined_elections_master
from party_taxonomy import apply_party_taxonomy_frame
from rebuild_bundle_from_camera_opendata_archives import (
    decode_member,
    fallback_municipality_id,
    safe_int,
)


SUMMARY_COLUMNS = preprocess.CONTRACTS["municipality_summary.csv"]
RESULT_COLUMNS = preprocess.CONTRACTS["municipality_results_long.csv"]
ELECTION_COLUMNS = [
    "election_key",
    "election_year",
    "election_date",
    "election_label",
    "electoral_system",
    "status",
    "is_complete",
    "comparability_notes",
    "source_notes",
]

FIELD_ALIASES = {
    "circumscription": ["CIRCOSCRIZIONE", "DESCRCIRC", "DESCCIRCEUROPEA"],
    "region": ["REGIONE", "DESCRREG", "DESCREGIONE"],
    "province": ["PROVINCIA", "DESCRPROV", "DESCPROVINCIA"],
    "municipality": ["COMUNE", "DESCRCOMUNE", "DESCCOMUNE"],
    "party": ["LISTA", "DESCLISTA", "DESCRLISTA"],
    "votes": ["VOTI_LISTA", "VOTILISTA", "NUMVOTI"],
    "electors": ["ELETTORI"],
    "voters": ["VOTANTI"],
}


def log(message: str) -> None:
    print(f"[europe] {message}", flush=True)


def field_value(row: Mapping[str, str], aliases: Iterable[str]) -> str:
    for key in aliases:
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def fast_key(value: object) -> str:
    text = str(value or "").replace("&", " e ").replace("'", " ").replace("’", " ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.casefold())).strip()


@lru_cache(maxsize=None)
def clean_title(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().strip('"'))
    if not text:
        return ""
    if any(char.islower() for char in text):
        return text
    titled = text.lower().title()
    for old, new in {
        " Di ": " di ", " Del ": " del ", " Della ": " della ", " Delle ": " delle ",
        " Dei ": " dei ", " Degli ": " degli ", " E ": " e ", " In ": " in ",
        " Sul ": " sul ", " Sulla ": " sulla ", " Al ": " al ", " Alla ": " alla ",
        " Da ": " da ", " De ": " de ", " D'": " d'", " L'": " l'",
    }.items():
        titled = titled.replace(old, new)
    return titled


@lru_cache(maxsize=None)
def clean_region(value: str) -> str:
    return clean_title(value)


@lru_cache(maxsize=None)
def clean_municipality(value: str) -> Tuple[str, str]:
    observed = clean_title(value)
    base = re.sub(r"(?i)^parte d(?:el|i) comune(?: di)?\s+", "", observed).strip()
    if re.fullmatch(r"(?i)milano\s+\d+", base):
        base = "Milano"
    return observed, clean_title(base)


@lru_cache(maxsize=None)
def clean_party(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().strip('"'))


def choose_municipality_member(entry: Mapping[str, object]) -> str:
    year = int(entry["year"])
    members = [str(value) for value in entry.get("members") or []]
    if year == 2024:
        exact = [name for name in members if Path(name).name.casefold() == "europee_italia_livcomune.csv".casefold()]
        if exact:
            return exact[0]

    candidates = []
    for name in members:
        lowered = Path(name).name.casefold()
        if not lowered.endswith((".txt", ".csv")):
            continue
        if any(token in lowered for token in ("prefer", "sezion", "estero", "candidat", "fuorisede", "fuori_sede")):
            continue
        candidates.append(name)
    if not candidates:
        raise ValueError(f"No municipality member in {entry.get('filename')}")

    dated = str(entry.get("election_date") or "").replace("-", "")
    preferred = [name for name in candidates if dated and dated in Path(name).name]
    if preferred:
        return sorted(preferred, key=len)[0]
    municipality = [name for name in candidates if "livcomune" in Path(name).name.casefold()]
    if municipality:
        return sorted(municipality, key=len)[0]
    return sorted(candidates, key=len)[0]


def read_archive_rows(archive_path: Path, member: str) -> Iterable[Dict[str, str]]:
    with zipfile.ZipFile(archive_path) as archive:
        text = decode_member(archive.read(member))
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    if not reader.fieldnames:
        raise ValueError(f"Missing CSV header in {archive_path.name}:{member}")
    for raw in reader:
        yield {
            str(key or "").strip().strip('"').lstrip("\ufeff"): str(value or "").strip().strip('"')
            for key, value in raw.items()
            if key is not None
        }


def max_count(previous: object, current: Optional[int]) -> Optional[int]:
    if current is None:
        return previous if previous not in ("", None) else None
    if previous in ("", None):
        return current
    return max(int(previous), current)


def append_note(value: object, note: str) -> str:
    parts = [part for part in str(value or "").split("|") if part]
    if note and note not in parts:
        parts.append(note)
    return "|".join(parts)


def load_compact_reference_maps(root: Path) -> Tuple[Dict, Dict, Dict, Dict, Dict, Dict]:
    """Build the resolver maps from the compact lineage master, not 243 MB geometry."""
    master_path = root / "data" / "derived" / "municipalities_master.csv"
    by_name_prov: Dict[Tuple[str, str], Dict[str, str]] = {}
    by_name_region: Dict[Tuple[str, str], Dict[str, str]] = {}
    candidates: Dict[str, List[Dict[str, str]]] = {}
    with master_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            municipality_id = str(row.get("municipality_id") or "").strip()
            geometry_id = str(row.get("geometry_id") or municipality_id).strip()
            province = clean_title(str(row.get("province_current") or ""))
            region = clean_region(str(row.get("region") or ""))
            name_current = clean_title(str(row.get("name_current") or ""))
            record = {
                "municipality_id": municipality_id,
                "geometry_id": geometry_id,
                "province": province,
                "region": region,
                "name_current": name_current,
            }
            aliases = [name_current]
            for column in ("name_historical", "alias_names"):
                aliases.extend(str(row.get(column) or "").split("|"))
            for alias in aliases:
                normalized = fast_key(alias)
                keys = [normalized]
                compact = normalized.replace(" ", "")
                if len(compact) >= 5 and compact != normalized:
                    keys.append(compact)
                for key in keys:
                    if not key:
                        continue
                    candidates.setdefault(key, []).append(record)
                    by_name_prov.setdefault((key, fast_key(province)), record)
                    by_name_region.setdefault((key, fast_key(region)), record)
    by_name = {}
    for key, records in candidates.items():
        unique = {(row["municipality_id"], row["geometry_id"]) for row in records}
        if len(unique) == 1:
            by_name[key] = records[0]
    return by_name_prov, by_name_region, by_name, by_name_prov, by_name_region, by_name


def resolve_compact_reference(
    municipality_name: str,
    province: str,
    region: str,
    references: Tuple[Dict, Dict, Dict, Dict, Dict, Dict],
    election_year: int,
) -> Tuple[Optional[Dict[str, str]], str]:
    by_name_prov, by_name_region, by_name, _, _, _ = references
    normalized = fast_key(municipality_name)
    keys = [normalized]
    compact = normalized.replace(" ", "")
    if len(compact) >= 5 and compact != normalized:
        keys.append(compact)
    province_key = fast_key(province)
    region_key = fast_key(region)
    for key in keys:
        if (key, province_key) in by_name_prov:
            return by_name_prov[(key, province_key)], "lineage_master_name_province"
        if region_key and (key, region_key) in by_name_region:
            return by_name_region[(key, region_key)], "lineage_master_name_region"
        if key in by_name:
            return by_name[key], "lineage_master_unique_name"
    # The official 1999 municipality member systematically drops the letter P
    # from place names (for example Porto Tolle -> Orto Tolle). Repair only
    # unique same-province matches, preserving the anomaly in the audit note.
    if election_year == 1999 and province_key:
        candidates = {
            (record["municipality_id"], record["geometry_id"]): record
            for (candidate_key, candidate_province), record in by_name_prov.items()
            if candidate_province == province_key and candidate_key.replace("p", "") == normalized.replace("p", "")
        }
        if len(candidates) == 1:
            return next(iter(candidates.values())), "official_1999_missing_p_repaired"
    return None, ""


def write_frame_chunk(handle, frame: pd.DataFrame, columns: List[str], include_header: bool) -> None:
    safe = frame.copy()
    for column in columns:
        if column not in safe.columns:
            safe[column] = ""
    safe[columns].to_csv(handle, index=False, header=include_header, lineterminator="\n")


def parse_election(
    root: Path,
    entry: Mapping[str, object],
    references: Tuple[Dict, Dict, Dict, Dict, Dict, Dict],
    province_region_by_key: Mapping[str, str],
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, object], Dict[str, object]]:
    year = int(entry["year"])
    election_key = str(entry.get("election_key") or f"europee_{year}")
    election_date = str(entry["election_date"])
    archive_path = root / str(entry["local_path"])
    member = choose_municipality_member(entry)
    if not archive_path.exists():
        raise FileNotFoundError(f"Archive missing: {archive_path}")

    (
        geometry_by_name_prov,
        geometry_by_name_region,
        geometry_by_name,
        historical_by_name_prov,
        historical_by_name_region,
        historical_by_name,
    ) = references
    resolution_cache: Dict[Tuple[str, str, str], Tuple[Optional[Dict[str, str]], str]] = {}
    turnout: Dict[Tuple[str, str], Dict[str, object]] = {}
    parties: Dict[Tuple[str, str, str], Dict[str, object]] = {}
    methods: Counter[str] = Counter()
    source_rows = 0
    positive_rows = 0

    for row in read_archive_rows(archive_path, member):
        source_rows += 1
        observed_name, municipality_name = clean_municipality(field_value(row, FIELD_ALIASES["municipality"]))
        if not municipality_name:
            continue
        province_raw = clean_title(field_value(row, FIELD_ALIASES["province"]))
        region_raw = clean_region(field_value(row, FIELD_ALIASES["region"]))
        lookup_key = (
            fast_key(municipality_name),
            fast_key(province_raw),
            fast_key(region_raw),
        )
        if lookup_key not in resolution_cache:
            resolution_cache[lookup_key] = resolve_compact_reference(
                municipality_name,
                province_raw,
                region_raw,
                references,
                year,
            )
        reference, resolution_method = resolution_cache[lookup_key]
        if resolution_method == "official_1999_missing_p_repaired":
            municipality_name = str((reference or {}).get("name_current") or municipality_name)
        province = province_raw or clean_title(str((reference or {}).get("province", "")))
        region = clean_region(
            region_raw
            or str((reference or {}).get("region", ""))
            or province_region_by_key.get(fast_key(province), "")
        )
        # Keep the source municipality distinct at the election date. Using a
        # current 2021 code here could prematurely merge historical predecessors;
        # the dated territorial crosswalk is the only layer allowed to do that.
        municipality_id = fallback_municipality_id(municipality_name, province)
        geometry_id = str((reference or {}).get("geometry_id") or "").strip()
        methods[resolution_method or "unresolved"] += 1

        notes = "official_eligendo_opendata_zip|european_election_municipality_result"
        if observed_name != municipality_name:
            notes = append_note(notes, "segment_aggregated_to_base_municipality")
        if resolution_method:
            notes = append_note(notes, resolution_method)
        if not geometry_id:
            notes = append_note(notes, "geometry_join_deferred_to_territorial_crosswalk")

        electors = safe_int(field_value(row, FIELD_ALIASES["electors"]))
        voters = safe_int(field_value(row, FIELD_ALIASES["voters"]))
        turnout_key = (election_key, municipality_id)
        bucket = turnout.get(turnout_key)
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
                "comparability_note": notes,
                "completeness_flag": "official_opendata_turnout_and_lists",
            }
            turnout[turnout_key] = bucket
        else:
            bucket["electors"] = max_count(bucket.get("electors"), electors)
            bucket["voters"] = max_count(bucket.get("voters"), voters)
            bucket["total_votes"] = max_count(bucket.get("total_votes"), voters)
            if not bucket.get("province") and province:
                bucket["province"] = province
            if not bucket.get("region") and region:
                bucket["region"] = region
            if not bucket.get("geometry_id") and geometry_id:
                bucket["geometry_id"] = geometry_id

        votes = safe_int(field_value(row, FIELD_ALIASES["votes"]))
        party_raw = clean_party(field_value(row, FIELD_ALIASES["party"]))
        if votes is None or votes <= 0 or not party_raw:
            continue
        positive_rows += 1
        party_key = (election_key, municipality_id, " ".join(party_raw.split()).casefold())
        party_bucket = parties.get(party_key)
        if party_bucket is None:
            party_bucket = {
                "election_key": election_key,
                "election_year": year,
                "election_date": election_date,
                "municipality_id": municipality_id,
                "municipality_name": municipality_name,
                "province": province,
                "region": region,
                "party_raw": party_raw,
                "party_std": party_raw,
                "party_family": "altro",
                "bloc": "altro",
                "votes": int(votes),
                "vote_share": None,
                "rank": None,
                "territorial_mode": "historical",
                "territorial_status": "observed_opendata_zip",
                "geometry_id": geometry_id,
                "comparability_note": notes,
            }
            parties[party_key] = party_bucket
        else:
            party_bucket["votes"] = int(party_bucket["votes"]) + int(votes)

    party_frame = pd.DataFrame(parties.values())
    if party_frame.empty:
        raise ValueError(f"No party results parsed for {election_key}")
    # Preserve every official ballot label in party_raw, while allowing the
    # election-aware taxonomy to choose the concise UI identity in party_std.
    party_frame["party_std"] = ""
    party_frame = apply_party_taxonomy_frame(party_frame, preprocess.infer_party_meta)
    party_frame["votes"] = pd.to_numeric(party_frame["votes"], errors="coerce").fillna(0).astype(int)
    denominators = party_frame.groupby(["election_key", "municipality_id"], sort=False)["votes"].transform("sum")
    party_frame["vote_share"] = (party_frame["votes"] / denominators.where(denominators > 0) * 100).round(8)
    party_frame["rank"] = party_frame.groupby(["election_key", "municipality_id"])["votes"].rank(method="dense", ascending=False).astype("Int64")

    turnout_frame = pd.DataFrame(turnout.values())
    valid_votes = party_frame.groupby(["election_key", "municipality_id"], sort=False)["votes"].sum().rename("valid_votes")
    turnout_frame = turnout_frame.drop(columns=["valid_votes"], errors="ignore").merge(
        valid_votes.reset_index(), on=["election_key", "municipality_id"], how="left"
    )
    turnout_frame["turnout_pct"] = (
        pd.to_numeric(turnout_frame["voters"], errors="coerce")
        / pd.to_numeric(turnout_frame["electors"], errors="coerce").where(pd.to_numeric(turnout_frame["electors"], errors="coerce") > 0)
        * 100
    ).round(8)
    summary_frame = preprocess.build_summary(turnout_frame, party_frame)

    national = party_frame.groupby(["party_raw", "party_std", "party_family", "bloc"], sort=False)["votes"].sum().reset_index()
    national = national.sort_values(["votes", "party_raw"], ascending=[False, True])
    national_total = int(national["votes"].sum())
    winner = national.iloc[0].to_dict()
    audit = {
        "election_key": election_key,
        "election_year": year,
        "election_date": election_date,
        "archive_filename": str(entry["filename"]),
        "archive_sha256": str(entry.get("sha256") or ""),
        "primary_member": member,
        "source_rows": source_rows,
        "positive_party_rows": positive_rows,
        "municipality_rows": int(len(summary_frame)),
        "result_rows": int(len(party_frame)),
        "municipalities_with_geometry_id": int(summary_frame["geometry_id"].astype(str).str.strip().ne("").sum()),
        "municipalities_without_geometry_id": int(summary_frame["geometry_id"].astype(str).str.strip().eq("").sum()),
        "national_valid_list_votes": national_total,
        "national_winner_raw": str(winner.get("party_raw") or ""),
        "national_winner_std": str(winner.get("party_std") or ""),
        "national_winner_votes": int(winner.get("votes") or 0),
        "national_winner_share": round(int(winner.get("votes") or 0) / national_total * 100, 4) if national_total else None,
        "resolution_methods": dict(sorted(methods.items())),
        "top_parties": [
            {
                "party_raw": str(row.party_raw),
                "party_std": str(row.party_std),
                "votes": int(row.votes),
                "share": round(int(row.votes) / national_total * 100, 4) if national_total else None,
            }
            for row in national.head(15).itertuples(index=False)
        ],
    }
    election = {
        "election_key": election_key,
        "election_year": year,
        "election_date": election_date,
        "election_label": f"Europee {year}",
        "electoral_system": "proportional_european_list",
        "status": "completed",
        "is_complete": "true",
        "comparability_notes": (
            f"official_eligendo_opendata_zip; election_type=europee; primary_member={member}; "
            f"territorial_source_rows={len(summary_frame)}"
        ),
        "source_notes": (
            f"source=eligendo_opendata_zip; scope=italy_municipalities; election_type=europee; "
            f"archive={entry['filename']}; primary_member={member}; source_rows={source_rows}; "
            f"unique_municipalities={len(summary_frame)}; result_rows={len(party_frame)}"
        ),
    }
    return summary_frame[SUMMARY_COLUMNS], party_frame[RESULT_COLUMNS], election, audit


def main() -> None:
    parser = argparse.ArgumentParser(description="Build canonical European-election municipality sources.")
    parser.add_argument("--root", default=".", help="Electio repository root")
    parser.add_argument(
        "--manifest",
        default="data/reference/european_opendata_archives_manifest.json",
        help="Archive manifest relative to root",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    manifest_path = root / args.manifest
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = sorted(manifest.get("entries") or [], key=lambda row: int(row["year"]))
    if len(entries) != 10:
        raise ValueError(f"Expected 10 European elections, found {len(entries)}")

    derived = root / "data" / "derived"
    derived.mkdir(parents=True, exist_ok=True)
    preprocess.GEOMETRY_LOOKUP = preprocess.load_geometry_lookup(root / "data" / "reference")
    log("loading municipal reference maps")
    references = load_compact_reference_maps(root)
    province_region_by_key = {
        fast_key(record.get("province", "")): clean_region(str(record.get("region", "")))
        for record in references[0].values()
        if str(record.get("province") or "").strip() and str(record.get("region") or "").strip()
    }

    summary_path = derived / "european_municipality_summary.csv.gz"
    results_path = derived / "european_municipality_results_long.csv.gz"
    elections: List[Dict[str, object]] = []
    audits: List[Dict[str, object]] = []
    with gzip.open(summary_path, "wt", encoding="utf-8", newline="") as summary_handle, gzip.open(
        results_path, "wt", encoding="utf-8", newline=""
    ) as results_handle:
        for index, entry in enumerate(entries):
            log(f"parsing {entry['election_key']} from {entry['filename']}")
            summary, results, election, audit = parse_election(
                root, entry, references, province_region_by_key
            )
            write_frame_chunk(summary_handle, summary, SUMMARY_COLUMNS, include_header=index == 0)
            write_frame_chunk(results_handle, results, RESULT_COLUMNS, include_header=index == 0)
            elections.append(election)
            audits.append(audit)
            log(
                f"{entry['election_key']}: {len(summary):,} comuni, {len(results):,} righe, "
                f"vincitore {audit['national_winner_std']} {audit['national_winner_share']:.2f}%"
            )

    elections_path = derived / "european_elections_master.csv"
    pd.DataFrame(elections, columns=ELECTION_COLUMNS).to_csv(elections_path, index=False, lineterminator="\n")
    audit_payload = {
        "generated_by": "scripts/build_european_election_sources.py",
        "source_manifest": str(manifest_path.relative_to(root)).replace("\\", "/"),
        "archive_count": len(entries),
        "election_count": len(elections),
        "summary_asset": str(summary_path.relative_to(root)).replace("\\", "/"),
        "results_asset": str(results_path.relative_to(root)).replace("\\", "/"),
        "elections": audits,
    }
    (derived / "european_source_audit.json").write_text(
        json.dumps(audit_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    combined = publish_combined_elections_master(derived)
    log(f"wrote {summary_path.relative_to(root)}")
    log(f"wrote {results_path.relative_to(root)}")
    log(f"published {len(combined)} elections in data/derived/elections_master.csv")


if __name__ == "__main__":
    main()
