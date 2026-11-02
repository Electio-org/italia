#!/usr/bin/env python3
"""Build the opt-in referendum pilot without rewriting the election bundle."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_territorial_history import (
    anpr_active_snapshot, iter_csv_rows, load_targets, name_variants, source_name_key,
)
from territorial_history import TerritorialResolver, normalize_text, succession_events_from_rows

KEY = "referendum_2016_12_04_q1"
VOTE_DATE = "2016-12-04"
SOURCE_URL = "https://elezionistorico.interno.gov.it/daithome/documenti/opendata/referendum/referendum-20161204.zip"
COUNT_FIELDS = ("electors", "voters", "yes_votes", "no_votes", "blank_votes", "other_invalid_votes")
SOURCE_NAME_CORRECTIONS = {"cerrina": "cerrina monferrato", "tremosine": "tremosine garda",
                           "emarse": "emarese", "fnis": "fenis"}


def match_name(value):
    # The official export replaces some accented characters with '+'. ANPR
    # has the same names with a replacement character; compare the remainder.
    key = source_name_key(str(value).replace("+", "").replace("\ufffd", ""))
    return SOURCE_NAME_CORRECTIONS.get(key, key)


def integer(value):
    text = str(value or "").strip()
    if not text:
        return None
    if not text.isdigit():
        raise ValueError(f"Invalid non-negative count: {text!r}")
    return int(text)


def complete_counts(row):
    out = dict(row)
    yes, no = out.get("yes_votes"), out.get("no_votes")
    valid = yes + no if yes is not None and no is not None else None
    out["valid_votes"] = valid
    electors, voters, blank = (out.get(key) for key in ("electors", "voters", "blank_votes"))
    out["turnout_pct"] = voters / electors * 100 if electors and voters is not None else None
    out["yes_share"] = yes / valid * 100 if valid else None
    out["no_share"] = no / valid * 100 if valid else None
    out["balance"] = (yes - no) / valid * 100 if valid else None
    if voters is not None and valid is not None and blank is not None:
        residual = voters - valid - blank
        if residual < 0:
            raise ValueError(f"Votes exceed voters for {out.get('municipality_name', '')}")
        out["other_invalid_votes"] = residual
    else:
        out["other_invalid_votes"] = None
    return out


def parse_archive(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = [name for name in archive.namelist() if name.lower().endswith((".csv", ".txt"))]
        if len(members) != 1:
            raise ValueError("Expected one municipality result member")
        member = members[0]
        data = archive.read(member)
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    reader = csv.DictReader(io.StringIO(text, newline=None), delimiter=";")
    required = {"REGIONE", "PROVINCIA", "COMUNE", "NUM_REFERENDUM", "QUESITO", "ELETTORI", "VOTANTI", "NUMVOTISI", "NUMVOTINO", "SCHEDE_BIANCHE"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("Official referendum schema changed")
    rows, seen = [], set()
    for raw in reader:
        if str(raw["NUM_REFERENDUM"]).strip() != "1":
            raise ValueError("Unexpected question identifier")
        identity = tuple(str(raw[key]).strip() for key in ("REGIONE", "PROVINCIA", "COMUNE"))
        if identity in seen:
            raise ValueError(f"Duplicate municipality: {identity}")
        seen.add(identity)
        rows.append(complete_counts({
            "region": identity[0], "province": identity[1], "municipality_name": identity[2],
            "electors": integer(raw["ELETTORI"]), "voters": integer(raw["VOTANTI"]),
            "yes_votes": integer(raw["NUMVOTISI"]), "no_votes": integer(raw["NUMVOTINO"]),
            "blank_votes": integer(raw["SCHEDE_BIANCHE"]),
        }))
    if not rows:
        raise ValueError("Empty referendum archive")
    return rows, member


def sum_counts(rows):
    return {field: sum(row[field] for row in rows) if all(row.get(field) is not None for row in rows) else None
            for field in COUNT_FIELDS}


def build(root, archive_bytes):
    sources, member = parse_archive(archive_bytes)
    targets = load_targets(root / "data" / "derived")
    reference = root / "data" / "reference"
    events = list(iter_csv_rows(reference / "situas_municipality_events_1861_2021.csv.gz"))
    history = list(iter_csv_rows(reference / "municipality_registry_historical_anpr.csv.gz"))
    active = anpr_active_snapshot({"election_key": KEY, "election_date": VOTE_DATE}, history)
    by_name, by_alias = defaultdict(dict), defaultdict(dict)
    for row in active:
        by_name[match_name(row["name"])][row["istat_code"]] = row
        for variant in name_variants(row["name"]):
            by_alias[match_name(variant)][row["istat_code"]] = row
    province_siglas = defaultdict(set)
    for row in iter_csv_rows(reference / "municipality_registry_by_election.csv.gz"):
        if row.get("province") and row.get("province_sigla"):
            province_siglas[normalize_text(row["province"])].add(row["province_sigla"])
    resolver = TerritorialResolver(targets, succession_events_from_rows(events))
    split_events = defaultdict(list)
    for event in events:
        if event["event_code"] == "CECS" and VOTE_DATE < event["event_date"] <= "2021-12-31":
            split_events[event["source_code"]].append(event)
    mapped = defaultdict(list)
    methods, excluded, partial_targets, crosswalk = Counter(), [], set(), []
    for row in sources:
        candidates = dict(by_name.get(match_name(row["municipality_name"]), {}))
        if not candidates:
            for variant in name_variants(row["municipality_name"]):
                candidates.update(by_alias.get(match_name(variant), {}))
        siglas = province_siglas.get(normalize_text(row["province"]), set())
        local = {code: item for code, item in candidates.items() if item.get("province_sigla") in siglas}
        candidates = local if local else candidates
        codes = list(candidates)
        resolution = resolver.resolve(codes[0], date.fromisoformat(VOTE_DATE)) if len(codes) == 1 else None
        target_ids = list(resolution.targets) if resolution else []
        split = split_events.get(codes[0], []) if len(codes) == 1 else []
        for event in split:
            target_ids.extend(resolver.resolve(event["related_code"], date.fromisoformat(event["event_date"])).targets)
        target_ids = sorted(set(target_ids))
        entry = {"source_name": row["municipality_name"], "source_province": row["province"],
                 "historical_code": codes[0] if len(codes) == 1 else None, "targets": target_ids}
        if len(target_ids) != 1:
            entry["status"] = "ambiguous_split" if target_ids else "unresolved"
            excluded.append({**entry, **sum_counts([row])})
            partial_targets.update(target_ids)
        else:
            entry["status"] = "resolved"
            mapped[target_ids[0]].append(row)
            methods["dated_name_province" if local else "dated_unique_name"] += 1
        crosswalk.append(entry)
    municipalities = []
    for code, predecessors in sorted(mapped.items()):
        target = targets[code]
        municipalities.append(complete_counts({
            "municipality_id": code, "geometry_id": code,
            "municipality_name": target["name"], "province": target["province"], "region": target["region"],
            "source_names": [row["municipality_name"] for row in predecessors],
            "source_count": len(predecessors), "coverage_status": "partial" if code in partial_targets else "resolved",
            **sum_counts(predecessors),
        }))
    national = complete_counts(sum_counts(sources))
    mapped_counts = complete_counts(sum_counts([row for group in mapped.values() for row in group]))
    audit = {
        "schema_version": 1, "consultation_key": KEY, "source_url": SOURCE_URL, "source_member": member,
        "source_sha256": hashlib.sha256(archive_bytes).hexdigest(), "scope": "Italia; estero escluso",
        "source_municipalities": len(sources), "mapped_source_municipalities": sum(map(len, mapped.values())),
        "map_municipalities": len(municipalities), "geometry_municipalities": len(targets),
        "national": national, "mapped": mapped_counts, "resolution_methods": dict(methods),
        "excluded": excluded,
        "method": "ANPR identities valid on 2016-12-04; date-aware ISTAT SITUAS succession to 2021 geometry. Ambiguous splits are excluded, never apportioned.",
        "boundary_note": "2021 map boundaries are not 2016 boundaries. CECS municipality splits are excluded; small boundary exchanges are not reconstructed at section level.",
        "invalid_votes_note": "other_invalid_votes = voters - yes_votes - no_votes - blank_votes; includes any disputed/non-attributed ballots, not an official null-ballot count.",
        "source_name_corrections": SOURCE_NAME_CORRECTIONS,
    }
    consultation = {"election_key": KEY, "election_year": 2016, "election_date": VOTE_DATE,
                    "election_label": "Referendum costituzionale 2016", "type": "constitutional",
                    "question_id": "1", "question_label": "Riforma costituzionale", "quorum_required": False,
                    "source_url": SOURCE_URL, "territorial_mode": "harmonized", "geometry_year": 2021,
                    "scope": "Italia, estero escluso", "national": national}
    return {"schema_version": 1, "consultation": consultation, "municipalities": municipalities}, audit, crosswalk


def write_json(path, payload, compressed=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
    path.write_bytes(gzip.compress(raw, mtime=0) if compressed else raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.archive:
        payload = args.archive.read_bytes()
    else:
        request = Request(SOURCE_URL, headers={"User-Agent": "Electio referendum builder/1.0"})
        with urlopen(request, timeout=60) as response:
            payload = response.read()
    bundle, audit, crosswalk = build(root, payload)
    folder = root / "data" / "derived" / "referendums"
    write_json(folder / f"{KEY}.json", bundle)
    write_json(folder / f"{KEY}.json.gz", bundle, compressed=True)
    write_json(folder / f"{KEY}_audit.json", audit)
    write_json(folder / f"{KEY}_crosswalk.json.gz", crosswalk, compressed=True)
    write_json(folder / "index.json", {"schema_version": 1, "consultations": [{
        **bundle["consultation"], "path": f"data/derived/referendums/{KEY}.json.gz",
        "audit_path": f"data/derived/referendums/{KEY}_audit.json", "row_count": len(bundle["municipalities"]),
    }]})
    print(json.dumps({"rows": len(bundle["municipalities"]), "excluded": len(audit["excluded"]),
                      "national": audit["national"], "excluded_examples": audit["excluded"][:8]}, ensure_ascii=True))


if __name__ == "__main__":
    main()
