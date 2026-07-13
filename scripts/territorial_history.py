#!/usr/bin/env python3
from __future__ import annotations

import csv
import gzip
import io
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple

import pandas as pd


TARGET_GEOMETRY_DATE = date(2021, 12, 31)
CROSSWALK_COLUMNS = [
    "election_key",
    "election_date",
    "source_municipality_id",
    "source_name",
    "source_province",
    "source_region",
    "historical_istat_code",
    "target_geometry_id",
    "target_name",
    "target_province",
    "target_region",
    "resolution_method",
    "confidence",
    "status",
    "lineage_path",
]


def normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = text.replace("j", "i")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def normalize_match_name(value: object) -> str:
    tokens = normalize_text(value).split()
    stop = {"d", "da", "dal", "de", "di", "del", "della", "delle", "dei", "degli", "nel", "nella", "nello", "sul", "sulla"}
    return " ".join(token for token in tokens if token not in stop)


def parse_iso_date(value: object) -> date | None:
    raw = str(value or "").strip()[:10]
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def join_distinct(values: Iterable[object], separator: str = "|") -> str:
    seen: Dict[str, None] = {}
    for value in values:
        text = str(value or "").strip()
        if text and text.lower() != "nan":
            seen.setdefault(text, None)
    return separator.join(seen)


def mode_text(values: Iterable[object]) -> str:
    cleaned = [str(value or "").strip() for value in values]
    cleaned = [value for value in cleaned if value and value.lower() != "nan"]
    if not cleaned:
        return ""
    counts = Counter(cleaned)
    return sorted(counts, key=lambda value: (-counts[value], value))[0]


def write_csv_gzip(path: Path, rows: Iterable[Mapping[str, object]], columns: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=list(columns), extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column, "") for column in columns})
    path.write_bytes(gzip.compress(buffer.getvalue().encode("utf-8"), compresslevel=9, mtime=0))


def read_csv_gzip(path: Path) -> List[Dict[str, str]]:
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


@dataclass(frozen=True)
class SuccessionEvent:
    event_date: date
    source_code: str
    target_code: str
    event_code: str


@dataclass(frozen=True)
class Resolution:
    targets: Tuple[str, ...]
    paths: Tuple[str, ...]


class TerritorialResolver:
    """Date-aware resolver from an historical municipality to 2021 geometry."""

    def __init__(self, target_codes: Iterable[str], events: Iterable[SuccessionEvent]):
        self.target_codes = frozenset(str(code).strip() for code in target_codes if str(code).strip())
        outgoing: Dict[str, List[SuccessionEvent]] = defaultdict(list)
        for event in events:
            if event.source_code and event.target_code:
                outgoing[event.source_code].append(event)
        self.outgoing = {
            code: sorted(items, key=lambda event: (event.event_date, event.target_code, event.event_code))
            for code, items in outgoing.items()
        }

    @lru_cache(maxsize=None)
    def resolve(self, source_code: str, valid_on: date) -> Resolution:
        source_code = str(source_code or "").strip()
        if not source_code:
            return Resolution((), ())

        frontier: List[Tuple[str, date, Tuple[str, ...]]] = [(source_code, valid_on, (source_code,))]
        targets: Dict[str, Tuple[str, ...]] = {}
        seen = set()

        while frontier:
            current, cursor, path = frontier.pop()
            state_key = (current, cursor)
            if state_key in seen:
                continue
            seen.add(state_key)
            events = [
                event for event in self.outgoing.get(current, [])
                if cursor < event.event_date <= TARGET_GEOMETRY_DATE
            ]
            if not events:
                if current in self.target_codes:
                    targets.setdefault(current, path)
                continue

            next_date = min(event.event_date for event in events)
            next_events = [event for event in events if event.event_date == next_date]
            for event in next_events:
                marker = f"{event.event_code}@{event.event_date.isoformat()}"
                frontier.append((event.target_code, event.event_date, (*path, marker, event.target_code)))

        target_ids = tuple(sorted(targets))
        paths = tuple(">".join(targets[target]) for target in target_ids)
        return Resolution(target_ids, paths)


def succession_events_from_rows(rows: Iterable[Mapping[str, object]]) -> List[SuccessionEvent]:
    events = []
    for row in rows:
        event_code = str(row.get("event_code") or "").strip().upper()
        if event_code not in {"ES", "AP", "RN"}:
            continue
        event_date = parse_iso_date(row.get("event_date"))
        source_code = str(row.get("source_code") or "").strip()
        target_code = str(row.get("related_code") or "").strip()
        if event_date and source_code and target_code:
            events.append(SuccessionEvent(event_date, source_code, target_code, event_code))
    return events


def load_crosswalk_frame(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, dtype=str, compression="infer").fillna("")
    required = {"election_key", "source_municipality_id", "target_geometry_id", "status"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Crosswalk privo delle colonne richieste: {sorted(missing)}")
    frame = frame[frame["status"] == "resolved"].copy()
    frame = frame[frame["target_geometry_id"].str.fullmatch(r"\d{6}", na=False)]
    frame = frame.drop_duplicates(["election_key", "source_municipality_id"], keep="first")
    return frame


def _merge_crosswalk(frame: pd.DataFrame, crosswalk: pd.DataFrame) -> pd.DataFrame:
    mapping = crosswalk[[
        "election_key",
        "source_municipality_id",
        "target_geometry_id",
        "target_name",
        "target_province",
        "target_region",
        "resolution_method",
    ]].rename(columns={"source_municipality_id": "municipality_id"})
    work = frame.merge(mapping, on=["election_key", "municipality_id"], how="inner", validate="many_to_one")
    return work


def aggregate_summary_counts(summary: pd.DataFrame, crosswalk: pd.DataFrame) -> pd.DataFrame:
    work = _merge_crosswalk(summary.fillna(""), crosswalk)
    numeric = ["electors", "voters", "valid_votes", "total_votes"]
    for column in numeric:
        work[column] = pd.to_numeric(work[column], errors="coerce")
    work["_source_changed"] = work["municipality_id"] != work["target_geometry_id"]

    keys = [
        "election_key",
        "election_year",
        "election_date",
        "target_geometry_id",
        "target_name",
        "target_province",
        "target_region",
    ]
    grouped = work.groupby(keys, sort=False, dropna=False)
    out = grouped[numeric].sum(min_count=1).reset_index()
    source_counts = grouped["municipality_id"].nunique().rename("_source_count").reset_index()
    changed = grouped["_source_changed"].any().rename("_source_changed").reset_index()
    completeness = grouped["completeness_flag"].apply(mode_text).rename("_source_completeness").reset_index()
    out = out.merge(source_counts, on=keys).merge(changed, on=keys).merge(completeness, on=keys)
    out["turnout_pct"] = out["voters"] / out["electors"] * 100
    return out


def supplement_summary_counts_from_results(
    summary_counts: pd.DataFrame,
    results: pd.DataFrame,
    crosswalk: pd.DataFrame,
) -> pd.DataFrame:
    """Add municipalities present in party results but absent from summary."""
    work = _merge_crosswalk(results.fillna(""), crosswalk)
    if work.empty:
        return summary_counts
    work["votes"] = pd.to_numeric(work["votes"], errors="coerce")
    work["_source_changed"] = work["municipality_id"] != work["target_geometry_id"]
    keys = [
        "election_key",
        "election_year",
        "election_date",
        "target_geometry_id",
        "target_name",
        "target_province",
        "target_region",
    ]
    grouped = work.groupby(keys, sort=False, dropna=False)
    fallback = grouped["votes"].sum(min_count=1).rename("valid_votes").reset_index()
    fallback = fallback.merge(
        grouped["municipality_id"].nunique().rename("_source_count").reset_index(),
        on=keys,
    ).merge(
        grouped["_source_changed"].any().rename("_source_changed").reset_index(),
        on=keys,
    )
    existing = set(zip(summary_counts["election_key"], summary_counts["target_geometry_id"]))
    missing_mask = [
        (election_key, geometry_id) not in existing
        for election_key, geometry_id in zip(fallback["election_key"], fallback["target_geometry_id"])
    ]
    fallback = fallback.loc[missing_mask].copy()
    if fallback.empty:
        return summary_counts
    fallback["electors"] = pd.NA
    fallback["voters"] = pd.NA
    fallback["total_votes"] = pd.NA
    fallback["turnout_pct"] = pd.NA
    fallback["_source_completeness"] = "reconstructed_from_party_results"
    fallback = fallback.reindex(columns=summary_counts.columns)
    return pd.concat([summary_counts, fallback], ignore_index=True)


def harmonize_results(
    results: pd.DataFrame,
    crosswalk: pd.DataFrame,
    summary_counts: pd.DataFrame,
) -> pd.DataFrame:
    work = _merge_crosswalk(results.fillna(""), crosswalk)
    work["votes"] = pd.to_numeric(work["votes"], errors="coerce")
    work["_party_key"] = work["party_std"].where(work["party_std"].str.strip() != "", work["party_raw"])
    keys = [
        "election_key",
        "election_year",
        "election_date",
        "target_geometry_id",
        "target_name",
        "target_province",
        "target_region",
        "_party_key",
    ]
    grouped = work.groupby(keys, sort=False, dropna=False)
    out = grouped["votes"].sum(min_count=1).reset_index()
    for column in ["party_raw", "party_std", "party_family", "bloc"]:
        values = grouped[column].apply(mode_text).rename(column).reset_index()
        out = out.merge(values, on=keys)

    denominators = summary_counts[["election_key", "target_geometry_id", "valid_votes"]]
    out = out.merge(denominators, on=["election_key", "target_geometry_id"], how="left", validate="many_to_one")
    fallback = out.groupby(["election_key", "target_geometry_id"])["votes"].transform("sum")
    denominator = out["valid_votes"].where(out["valid_votes"] > 0, fallback)
    out["vote_share"] = out["votes"] / denominator * 100
    out["rank"] = out.groupby(["election_key", "target_geometry_id"])["votes"].rank(method="dense", ascending=False)
    out["municipality_id"] = out["target_geometry_id"]
    out["municipality_name"] = out["target_name"]
    out["province"] = out["target_province"]
    out["region"] = out["target_region"]
    out["territorial_mode"] = "harmonized"
    out["territorial_status"] = "projected_to_2021_geometry"
    out["geometry_id"] = out["target_geometry_id"]
    out["comparability_note"] = "official_eligendo_opendata_zip|situas_lineage_projection_2021|share_recomputed"
    columns = [
        "election_key", "election_year", "election_date", "municipality_id", "municipality_name",
        "province", "region", "party_raw", "party_std", "party_family", "bloc", "votes",
        "vote_share", "rank", "territorial_mode", "territorial_status", "geometry_id",
        "comparability_note",
    ]
    return out[columns].sort_values(["election_key", "municipality_id", "rank", "party_std"])


def finalize_summary(summary_counts: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    out = summary_counts.copy()
    ranked = results.sort_values(
        ["election_key", "municipality_id", "votes", "party_std"],
        ascending=[True, True, False, True],
    )
    first = ranked.groupby(["election_key", "municipality_id"], sort=False).nth(0).reset_index()
    second = ranked.groupby(["election_key", "municipality_id"], sort=False).nth(1).reset_index()
    first = first[["election_key", "municipality_id", "party_std", "vote_share"]].rename(
        columns={"party_std": "first_party_std", "vote_share": "first_party_share"}
    )
    second = second[["election_key", "municipality_id", "party_std", "vote_share"]].rename(
        columns={"party_std": "second_party_std", "vote_share": "second_party_share"}
    )

    block_votes = (
        results[results["bloc"].str.strip() != ""]
        .groupby(["election_key", "municipality_id", "bloc"], sort=False)["votes"]
        .sum(min_count=1)
        .reset_index()
        .sort_values(["election_key", "municipality_id", "votes", "bloc"], ascending=[True, True, False, True])
    )
    dominant = block_votes.groupby(["election_key", "municipality_id"], sort=False).nth(0).reset_index()
    dominant = dominant[["election_key", "municipality_id", "bloc"]].rename(columns={"bloc": "dominant_block"})

    out["municipality_id"] = out["target_geometry_id"]
    out = out.merge(first, on=["election_key", "municipality_id"], how="left")
    out = out.merge(second, on=["election_key", "municipality_id"], how="left")
    out = out.merge(dominant, on=["election_key", "municipality_id"], how="left")
    out["first_second_margin"] = out["first_party_share"] - out["second_party_share"]
    out["municipality_name"] = out["target_name"]
    out["province"] = out["target_province"]
    out["region"] = out["target_region"]
    out["geometry_id"] = out["target_geometry_id"]
    out["territorial_mode"] = "harmonized"
    out["territorial_status"] = out.apply(
        lambda row: "harmonized_complete_predecessors"
        if int(row.get("_source_count") or 0) > 1 or bool(row.get("_source_changed"))
        else "observed_on_2021_geometry",
        axis=1,
    )
    base_note = "official_eligendo_opendata_zip|situas_lineage_projection_2021"
    out["comparability_note"] = out["_source_completeness"].apply(
        lambda value: f"{base_note}|summary_reconstructed_from_party_results"
        if value == "reconstructed_from_party_results" else base_note
    )
    out["completeness_flag"] = out["_source_completeness"].where(
        out["_source_completeness"].str.strip() != "", "harmonized_public_projection"
    )
    columns = [
        "election_key", "election_year", "election_date", "municipality_id", "municipality_name",
        "province", "region", "geometry_id", "territorial_mode", "territorial_status", "turnout_pct",
        "electors", "voters", "valid_votes", "total_votes", "first_party_std", "first_party_share",
        "second_party_std", "second_party_share", "first_second_margin", "dominant_block",
        "comparability_note", "completeness_flag",
    ]
    return out[columns].sort_values(["election_key", "municipality_id"])


def harmonize_public_frames(
    summary: pd.DataFrame,
    results: pd.DataFrame,
    crosswalk: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    counts = supplement_summary_counts_from_results(
        aggregate_summary_counts(summary, crosswalk),
        results,
        crosswalk,
    )
    harmonized_results = harmonize_results(results, crosswalk, counts)
    harmonized_summary = finalize_summary(counts, harmonized_results)
    return harmonized_summary, harmonized_results
