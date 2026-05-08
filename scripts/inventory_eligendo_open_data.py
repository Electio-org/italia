#!/usr/bin/env python3
"""Build a structured inventory of every open-data archive published by
the Italian Ministry of the Interior on Eligendo, broken down by
election type.

This script does *not* download or ingest any of the archives — it only
parses the listing page and records what is available. The output is a
single JSON file (`data/derived/sources_inventory_extended.json`) that
serves as the planning input for ingestion of Senato / Europee /
Regionali / Comunali / Referendum (and any other) elections.

The format of the inline tuples on the Eligendo page is, after
whitespace normalization::

    ["<election_type>", "<year>", "<relative_path>", "<filename>.zip", "<dd/mm/yyyy>"]

There are dozens of these tuples per page; one per archive. We pick
them up with a tolerant regex so that future re-runs keep working even
if the page indents differently.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional


OPEN_DATA_URL = "https://elezionistorico.interno.gov.it/eligendo/opendata.php"
BASE_DOWNLOAD_URL = "https://elezionistorico.interno.gov.it"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

DEFAULT_OUTPUT = Path("data/derived/sources_inventory_extended.json")

# Election families we care about. `provinciali` is included for
# completeness even though Italian provinces are no longer directly
# elected post-2014 — the historical archives are still useful.
KNOWN_FAMILIES = {
    "assemblea_costituente",
    "camera",
    "senato",
    "europee",
    "regionali",
    "provinciali",
    "comunali",
    "referendum",
}

# Per-family ingestion notes. These describe why each family is or
# isn't on the active ingestion roadmap and what's specifically needed
# before the data can land in the public bundle.
FAMILY_PROFILES: Dict[str, Dict[str, object]] = {
    "assemblea_costituente": {
        "scope": "italy",
        "granularity": "municipality",
        "ingestion_status": "ingested",
        "first_year": 1946,
        "notes": (
            "Already ingested via "
            "scripts/rebuild_bundle_from_camera_opendata_archives.py and exposed "
            "in municipality_summary.csv together with Camera."
        ),
    },
    "camera": {
        "scope": "italy",
        "granularity": "municipality",
        "ingestion_status": "ingested",
        "first_year": 1948,
        "notes": (
            "Already ingested via "
            "scripts/rebuild_bundle_from_camera_opendata_archives.py. Each archive "
            "contains a per-municipality `.txt` file (semicolon-separated) with "
            "one row per municipality / list."
        ),
    },
    "senato": {
        "scope": "italy",
        "granularity": "municipality",
        "ingestion_status": "candidate",
        "first_year": 1948,
        "priority": "high",
        "notes": (
            "Same archive layout as Camera (semicolon-separated `.txt` per "
            "municipality / list). Can almost certainly reuse "
            "rebuild_bundle_from_camera_opendata_archives.py with the "
            "election_type discriminator widened. Italian Senate uses a "
            "regional electoral basis (each region has its own party totals), "
            "so the per-comune aggregation needs region-aware logic for the "
            "swing/confronto views."
        ),
    },
    "europee": {
        "scope": "italy",
        "granularity": "municipality",
        "ingestion_status": "candidate",
        "first_year": 1979,
        "priority": "high",
        "notes": (
            "Five constituencies (Nord-Ovest, Nord-Est, Centro, Sud, Isole) "
            "rather than provinces; per-comune rows are still published. The "
            "party label space is the smallest of the families because EU "
            "parliament parties consolidate national lists."
        ),
    },
    "regionali": {
        "scope": "regional",
        "granularity": "municipality",
        "ingestion_status": "candidate",
        "first_year": 1970,
        "priority": "medium",
        "notes": (
            "One archive per regional cycle, but cycles are NOT synchronized: "
            "different regions vote in different years, especially after 2000. "
            "Special-statute regions (Valle d'Aosta, Trentino-Alto Adige, "
            "Friuli, Sicilia, Sardegna) have their own laws and may not appear "
            "in the same archives. Aggregation strategy needs to live at the "
            "(region, election_date) level rather than (year)."
        ),
    },
    "provinciali": {
        "scope": "provincial",
        "granularity": "municipality",
        "ingestion_status": "candidate",
        "first_year": 2004,
        "priority": "low",
        "notes": (
            "Provinces have not been directly elected since the 2014 "
            "Delrio reform (Law 56/2014). Only the 2004–2014 cycles are "
            "available, and even those are partial because not every "
            "province voted in the same year. Lower priority unless we "
            "want pre-2014 historical context."
        ),
    },
    "comunali": {
        "scope": "municipality",
        "granularity": "municipality",
        "ingestion_status": "deferred",
        "first_year": 1970,
        "priority": "medium-low",
        "notes": (
            "Largest archive count by far (163+ files) because every comune "
            "votes on its own schedule and many years have multiple archives "
            "(one per regional batch / runoff). Ingestion is feasible but the "
            "data shape differs from Camera/Senato (mayoral candidates "
            "rather than party lists, runoffs, ranked-choice variants), so a "
            "dedicated parser is required. Defer until the basic Camera + "
            "Senato + Europee triad is wired."
        ),
    },
    "referendum": {
        "scope": "italy",
        "granularity": "municipality",
        "ingestion_status": "candidate",
        "first_year": 1946,
        "priority": "medium",
        "notes": (
            "Binary YES/NO outcomes (or N options for a few historical "
            "referendums). The schema is simpler than party-list elections "
            "and a thin parser is enough; it just doesn't reuse most of the "
            "party-master plumbing. Useful for territorial maps of "
            "constitutional / institutional questions (1946 Repubblica/"
            "Monarchia, 2016 riforma costituzionale, 2020 taglio "
            "parlamentari, etc.)."
        ),
    },
}


def _fetch_html(url: str, timeout: int) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


_TUPLE_RE = re.compile(
    r'\[\s*"(?P<etype>[a-z_]+)"\s*,\s*"(?P<year>\d{4})"\s*,\s*'
    r'"(?P<rel>[^"]+)"\s*,\s*"(?P<name>[^"]+\.zip)"\s*,\s*'
    r'"(?P<date>[^"]+)"',
    flags=re.IGNORECASE,
)


def _parse_tuples(html: str) -> List[Dict[str, str]]:
    seen = set()
    out: List[Dict[str, str]] = []
    for m in _TUPLE_RE.finditer(html):
        etype = m.group("etype").lower()
        if etype not in KNOWN_FAMILIES:
            continue
        name = m.group("name")
        if name in seen:
            continue
        seen.add(name)
        out.append(
            {
                "election_type": etype,
                "year": m.group("year"),
                "election_date": m.group("date"),
                "relative_path": m.group("rel"),
                "filename": name,
                "download_url": (
                    f"{BASE_DOWNLOAD_URL}/daithome/documenti/opendata/"
                    f"{m.group('rel')}"
                ),
            }
        )
    return out


def _normalise_iso_date(dmy: str) -> Optional[str]:
    """`'02/06/1946' -> '1946-06-02'`. Returns `None` if the string is not a
    plain dd/mm/yyyy date."""
    parts = dmy.split("/")
    if len(parts) != 3:
        return None
    try:
        day = int(parts[0])
        month = int(parts[1])
        year = int(parts[2])
        return _dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def build_inventory(html: str, generated_at: str) -> Dict[str, object]:
    tuples = _parse_tuples(html)

    # Group by election_type and enrich each item with a normalized iso
    # date and a synthetic election_key in the same shape as the
    # existing dataset_registry entries (e.g. "senato_1948").
    grouped: Dict[str, List[Dict[str, object]]] = {fam: [] for fam in KNOWN_FAMILIES}
    for t in tuples:
        iso = _normalise_iso_date(t["election_date"])
        item = {
            "election_key": f"{t['election_type']}_{t['year']}",
            "year": int(t["year"]),
            "election_date_iso": iso,
            "election_date_label": t["election_date"],
            "filename": t["filename"],
            "download_url": t["download_url"],
            "relative_path": t["relative_path"],
        }
        grouped[t["election_type"]].append(item)
    for fam in grouped:
        grouped[fam].sort(key=lambda r: (r["year"], r["filename"]))

    families: List[Dict[str, object]] = []
    for fam in sorted(KNOWN_FAMILIES):
        items = grouped[fam]
        profile = FAMILY_PROFILES.get(fam, {})
        years = sorted({item["year"] for item in items})
        families.append(
            {
                "family": fam,
                "scope": profile.get("scope"),
                "granularity": profile.get("granularity"),
                "ingestion_status": profile.get("ingestion_status", "candidate"),
                "priority": profile.get("priority"),
                "notes": profile.get("notes"),
                "first_year_documented": years[0] if years else None,
                "last_year_documented": years[-1] if years else None,
                "year_count": len(years),
                "archive_count": len(items),
                "items": items,
            }
        )

    return {
        "generated_by": "scripts/inventory_eligendo_open_data.py",
        "generated_at": generated_at,
        "source": {
            "name": "Eligendo open data — Ministero dell'Interno",
            "listing_url": OPEN_DATA_URL,
            "download_base_url": BASE_DOWNLOAD_URL,
            "license": (
                "Italian PSI directive (Dlgs 36/2006); see "
                "https://elezionistorico.interno.gov.it/eligendo/info_opendata.php "
                "for the official terms."
            ),
            "archive_format": "ZIP, semicolon-separated `.txt` per archive",
        },
        "families": families,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to the output JSON inventory.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP timeout in seconds for fetching the listing page.",
    )
    parser.add_argument(
        "--from-html",
        default=None,
        help=(
            "Optional path to a pre-fetched copy of the Eligendo HTML page. "
            "Useful for offline runs and tests."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.from_html:
        html = Path(args.from_html).read_text(encoding="utf-8")
    else:
        try:
            html = _fetch_html(OPEN_DATA_URL, timeout=args.timeout)
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"Failed to fetch {OPEN_DATA_URL}: {exc}", file=sys.stderr)
            return 1

    generated_at = (
        _dt.datetime.now(tz=_dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
    )
    inventory = build_inventory(html, generated_at=generated_at)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    total = sum(len(fam["items"]) for fam in inventory["families"])
    print(f"Wrote {out_path} ({total} archives across "
          f"{len(inventory['families'])} families)")
    for fam in inventory["families"]:
        print(
            f"  {fam['family']:<22} status={fam['ingestion_status']:<10} "
            f"priority={str(fam.get('priority') or '-'):<14} "
            f"items={fam['archive_count']:<4} "
            f"years={fam['first_year_documented']}–{fam['last_year_documented']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
