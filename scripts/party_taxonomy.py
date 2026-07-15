#!/usr/bin/env python3
"""Election-aware party taxonomy helpers.

The raw list label remains the source fact. Exact overrides only prevent
cross-era identity collisions and assign broad analytical families/blocks.
Unknown or ambiguous labels keep their raw identity through the fallback.
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path
from typing import Callable, Dict, Mapping, Optional, Tuple

import pandas as pd


DEFAULT_REGISTRY = Path(__file__).resolve().parents[1] / "data" / "reference" / "party_taxonomy_overrides.csv"


def taxonomy_key(election_key: object, party_raw: object) -> Tuple[str, str]:
    return str(election_key or "").strip(), " ".join(str(party_raw or "").split()).casefold()


@lru_cache(maxsize=4)
def load_party_taxonomy(path: str = str(DEFAULT_REGISTRY)) -> Dict[Tuple[str, str], Dict[str, str]]:
    registry: Dict[Tuple[str, str], Dict[str, str]] = {}
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            key = taxonomy_key(row.get("election_key"), row.get("party_raw"))
            if not key[0] or not key[1]:
                raise ValueError(f"Invalid party taxonomy row: {row}")
            if key in registry:
                raise ValueError(f"Duplicate party taxonomy key: {key}")
            registry[key] = dict(row)
    return registry


def exact_party_meta(
    election_key: object,
    party_raw: object,
    registry: Optional[Mapping[Tuple[str, str], Mapping[str, str]]] = None,
) -> Optional[Dict[str, str]]:
    source = registry or load_party_taxonomy()
    row = source.get(taxonomy_key(election_key, party_raw))
    if not row:
        return None
    return {
        "display": str(row.get("party_display_name") or row.get("party_std") or party_raw),
        "party_std": str(row.get("party_std") or party_raw),
        "family": str(row.get("party_family") or "altro"),
        "bloc": str(row.get("bloc") or "altro"),
        "color": str(row.get("color") or "#64748b"),
        "classification_status": str(row.get("classification_status") or "curated_exact"),
        "notes": str(row.get("notes") or ""),
    }


def resolve_party_meta(
    election_key: object,
    party_raw: object,
    fallback: Callable[[str], Mapping[str, str]],
    registry: Optional[Mapping[Tuple[str, str], Mapping[str, str]]] = None,
) -> Dict[str, str]:
    exact = exact_party_meta(election_key, party_raw, registry)
    if exact:
        return exact
    raw = str(party_raw or "").strip()
    inferred = dict(fallback(raw))
    inferred.setdefault("display", raw or "N/D")
    inferred.setdefault("party_std", inferred["display"])
    inferred.setdefault("family", "altro")
    inferred.setdefault("bloc", "altro")
    inferred.setdefault("color", "#64748b")
    inferred["classification_status"] = "fallback_rule"
    inferred["notes"] = ""
    return inferred


def apply_party_taxonomy_frame(
    frame: pd.DataFrame,
    fallback: Callable[[str], Mapping[str, str]],
    registry: Optional[Mapping[Tuple[str, str], Mapping[str, str]]] = None,
) -> pd.DataFrame:
    if frame.empty:
        return frame.copy()
    required = {"election_key", "party_raw"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Party results missing taxonomy columns: {sorted(missing)}")
    source = registry or load_party_taxonomy()
    out = frame.copy()
    cache: Dict[Tuple[str, str], Dict[str, str]] = {}
    raw_by_key: Dict[Tuple[str, str], str] = {}
    row_keys = []
    for election_key, party_raw in zip(out["election_key"], out["party_raw"]):
        key = taxonomy_key(election_key, party_raw)
        row_keys.append(key)
        raw_by_key.setdefault(key, str(party_raw or "").strip())
    for key, raw in raw_by_key.items():
        cache[key] = resolve_party_meta(key[0], raw, fallback, source)
    metadata = pd.Series(row_keys, index=out.index).map(cache)
    exact_mask = metadata.map(lambda item: item.get("classification_status") == "curated_exact")
    inferred_standard = metadata.map(lambda item: item.get("party_std") or item.get("display"))
    existing_standard = out.get("party_std", pd.Series("", index=out.index)).astype(str)
    out["party_std"] = existing_standard.where(
        (~exact_mask) & (existing_standard.str.strip() != ""),
        inferred_standard,
    )
    out["party_family"] = metadata.map(lambda item: item.get("family") or "altro")
    out["bloc"] = metadata.map(lambda item: item.get("bloc") or "altro")
    if "comparability_note" in out.columns:
        out.loc[exact_mask, "comparability_note"] = out.loc[exact_mask, "comparability_note"].map(
            lambda value: f"{value}|party_taxonomy_exact" if str(value).strip() else "party_taxonomy_exact"
        )
    return out
