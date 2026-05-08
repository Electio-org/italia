# Eligendo open-data sources inventory

This document describes `data/derived/sources_inventory_extended.json` — the
machine-readable inventory of every electoral archive published by the
Italian Ministry of the Interior on
[Eligendo open data](https://elezionistorico.interno.gov.it/eligendo/opendata.php).

The inventory is **planning input**, not raw electoral data. It does not
contain vote counts; it lists what archives are available, where to
download them, and which ones still need ingestion.

## Why this exists

The current bundle ingests **Camera + Assemblea Costituente 1946** only
(20 election archives). Eligendo publishes 8 election families with
**284 archives** in total. Before we wire up Senato, Europee, Regionali,
Comunali or Referendum we want a single source-of-truth for what's out
there, so subsequent ingestion PRs can be scoped against a stable list
instead of re-scraping the page every time.

## How to regenerate

```bash
python3 scripts/inventory_eligendo_open_data.py
# or, against a pre-fetched HTML copy:
python3 scripts/inventory_eligendo_open_data.py --from-html /tmp/eligendo.html
```

Zero non-stdlib dependencies. The script writes to
`data/derived/sources_inventory_extended.json` by default.

## Output shape

Top-level fields:

| Field | Description |
| --- | --- |
| `generated_by` | The script path. |
| `generated_at` | UTC ISO timestamp. |
| `source` | Provider metadata (listing URL, base download URL, license blurb, archive format). |
| `families` | Array of one entry per election family. |

Each `families` entry:

| Field | Description |
| --- | --- |
| `family` | Election family key (e.g. `senato`, `comunali`). |
| `scope` | Geographic scope of the contest (`italy`, `regional`, `provincial`, `municipality`). |
| `granularity` | Smallest published unit — currently always `municipality` for these archives. |
| `ingestion_status` | `ingested`, `candidate`, or `deferred`. |
| `priority` | Free-text roadmap priority for ingestion. `null` for already-ingested families. |
| `notes` | Human-readable rationale for the status / priority. |
| `first_year_documented`, `last_year_documented`, `year_count`, `archive_count` | Coverage summary numbers. |
| `items` | Sorted list of `{election_key, year, election_date_iso, election_date_label, filename, download_url, relative_path}`. |

`election_key` follows the same `{family}_{year}` shape as the existing
`elections_master.csv` (`camera_2022`, `senato_1948`, etc.) so the
inventory is drop-in compatible with the existing dataset registry when
ingestion lands.

## Snapshot of current coverage

As of the most recent run:

| Family | Status | Priority | Items | Years |
| --- | --- | --- | --- | --- |
| `assemblea_costituente` | ingested | — | 1 | 1946 |
| `camera` | ingested | — | 19 | 1948–2022 |
| `senato` | candidate | high | 19 | 1948–2022 |
| `europee` | candidate | high | 10 | 1979–2024 |
| `regionali` | candidate | medium | 37 | 1970–2025 |
| `referendum` | candidate | medium | 25 | 1946–2025 |
| `provinciali` | candidate | low | 10 | 2004–2011 |
| `comunali` | deferred | medium-low | 163 | 1970–2025 |

(Numbers regenerate on every script run; see the JSON for the live
counts.)

## Ingestion roadmap notes (per family)

The reasoning lives in `FAMILY_PROFILES` inside
`scripts/inventory_eligendo_open_data.py`. Highlights:

- **Senato (1948–2022)**: same archive layout as Camera. Almost
  certainly reusable via
  `scripts/rebuild_bundle_from_camera_opendata_archives.py` once the
  `election_type` discriminator is widened. The only architectural
  wrinkle is that Senato has a regional electoral basis, so the
  swing/confronto views need region-aware logic.
- **Europee (1979–2024)**: five constituencies (Nord-Ovest, Nord-Est,
  Centro, Sud, Isole) instead of provinces. Per-comune rows still
  published. Smallest party-label space across all families.
- **Referendum (1946–2025)**: simpler schema (binary YES/NO or N
  options). A thin parser is enough but it doesn't reuse the
  party-master plumbing. Useful for territorial maps of constitutional
  questions.
- **Regionali (1970–2025)**: one archive per cycle but cycles are not
  synchronized across regions, especially after 2000. Aggregation must
  be `(region, election_date)` rather than `(year)`. Special-statute
  regions (VdA, TAA, FVG, Sicilia, Sardegna) may not appear in the
  same archives.
- **Comunali (1970–2025)**: 163 archives, every comune on its own
  schedule, mayoral candidates / runoffs / ranked variants. Dedicated
  parser required. **Deferred** until the basic Camera + Senato +
  Europee triad is wired.
- **Provinciali (2004–2011)**: provinces no longer directly elected
  post-Delrio (Law 56/2014), only the 2004–2014 cycles exist and even
  those are partial. Lowest priority.

## Not in scope here

- No archives are downloaded. The inventory is metadata only.
- No electoral data is added to the public bundle. That happens in
  follow-up PRs.
- `dataset_registry.json` and `data_products.json` are not touched.
  Those are generated by `preprocess.py` when ingestion actually runs.
- No assumption is made about per-archive party-label normalization.
  Each family will need its own mapping once ingested.
