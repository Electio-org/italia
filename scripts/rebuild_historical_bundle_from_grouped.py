#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pandas as pd
import requests
from bs4 import BeautifulSoup

import preprocess


CURRENT_VERSION = "0.13.0"
HISTORICAL_YEARS = [1948, 1953, 1958, 1963, 1968, 1972, 1976, 1979, 1983, 1987, 1992]
DEFAULT_PIPELINE_ROOT = Path(r"C:\Users\sim11\Downloads\camera_lombardia_only_suite_v5\camera_lombardia_only_suite_v5")
DEFAULT_SOURCE_ROOT = Path(r"D:\camera_lombardia_only_suite_v5\lombardia_camera_app_v35\data\intermediate\historical_fixed_source")
DEFAULT_COMPARE_JSON = DEFAULT_PIPELINE_ROOT / "out_coverage_compare" / "bundle_vs_archive.json"
DEFAULT_COMPARE_CSV = DEFAULT_PIPELINE_ROOT / "out_coverage_compare" / "bundle_vs_archive.csv"
MAX_WORKERS = 8
TIMEOUT = 30
RETRIES = 3

TURNOUT_COLUMNS = [
    "url",
    "html_file",
    "title",
    "elettori",
    "votanti",
    "percentuale_votanti",
    "schede_bianche",
    "schede_nulle",
    "schede_contestate",
]
TABLE_INDEX_COLUMNS = ["url", "html_file", "n_tables"]
TABLES_LONG_COLUMNS = ["__table_idx", "__url", "__html_file", "__title", "__rownum", "column_name", "cell_value"]
ENTITY_COLUMNS = ["url", "html_file", "title", "municipality_name", "heading_1", "heading_2", "table_count", "text_excerpt"]


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_csv_records(path: Path) -> List[Dict[str, str]]:
    with path.open(encoding="utf-8", errors="replace", newline="") as fh:
        return list(csv.DictReader(fh))


def write_csv(path: Path, fieldnames: List[str], rows: Iterable[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def safe_read_tables(html: str) -> List[pd.DataFrame]:
    try:
        return pd.read_html(StringIO(html))
    except Exception:
        return []


def find_turnout_numbers(text: str) -> Dict[str, str]:
    collapsed = re.sub(r"\s+", " ", text or "")
    patterns = {
        "elettori": r"Elettori\s+(\d[\d\.\,]*)",
        "votanti": r"Votanti\s+(\d[\d\.\,]*)",
        "percentuale_votanti": r"Votanti\s+\d[\d\.\,]*\s+([\d\.,]+)\s*%",
        "schede_bianche": r"Schede bianche\s+(\d[\d\.\,]*)",
        "schede_nulle": r"Schede nulle\s+(\d[\d\.\,]*)",
        "schede_contestate": r"Schede contestate e non assegnate\s+(\d[\d\.\,]*)",
    }
    out: Dict[str, str] = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, collapsed, flags=re.I)
        out[key] = match.group(1) if match else ""
    return out


def split_archivio_token(value: str) -> Optional[Tuple[str, str, str]]:
    token = str(value or "").strip()
    match = re.fullmatch(r"(?P<entity>.+?)-lev(?P<level>\d)(?P<lev_value>\d+)", token)
    if not match:
        return None
    return match.group("entity"), match.group("level"), match.group("lev_value")


def normalize_historical_url(url: str) -> str:
    parsed = urlparse(str(url or ""))
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for level in ("1", "2", "3", "4"):
        for key in (f"lev{level}", f"ne{level}"):
            split = split_archivio_token(params.get(key, ""))
            if not split:
                continue
            entity, split_level, lev_value = split
            params[f"ne{split_level}"] = entity
            params[f"lev{split_level}"] = lev_value
            params.setdefault(f"es{split_level}", "N")
            params.setdefault(f"levsut{split_level}", split_level)
    if params.get("lev3") and params.get("lev3") != "0":
        params["tpe"] = "C"
    norm_query = urlencode(sorted(params.items()))
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, norm_query, ""))


def parse_dtel(url: str) -> str:
    parsed = urlparse(url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    return str(params.get("dtel") or "")


def build_entity_record(url: str, html_file: str, html: str, tables: List[pd.DataFrame]) -> Dict[str, str]:
    soup = BeautifulSoup(html, "lxml")
    headings = [h.get_text(" ", strip=True) for h in soup.find_all(["h1", "h2", "h3", "h4"]) if h.get_text(" ", strip=True)]
    municipality_heading = ""
    for heading in headings:
        if "COMUNE" in heading.upper():
            municipality_heading = heading
            break
    text = soup.get_text(" ", strip=True)
    return {
        "url": url,
        "html_file": html_file,
        "title": soup.title.get_text(" ", strip=True) if soup.title else "",
        "municipality_name": municipality_heading,
        "heading_1": headings[0] if len(headings) > 0 else "",
        "heading_2": headings[1] if len(headings) > 1 else "",
        "table_count": str(len(tables)),
        "text_excerpt": text[:1000],
    }


def url_html_file(url: str) -> str:
    import hashlib

    return f"{hashlib.sha1(url.encode('utf-8')).hexdigest()}.html"


def fetch_html(url: str, timeout: int = TIMEOUT) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(1, RETRIES + 1):
        session = requests.Session()
        session.trust_env = False
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            response.encoding = response.encoding or "utf-8"
            return response.text
        except Exception as exc:  # pragma: no cover - network variability
            last_error = exc
            if attempt < RETRIES:
                time.sleep(1.0 * attempt)
        finally:
            session.close()
    raise RuntimeError(f"fetch failed for {url}: {last_error}")


def municipality_candidate_rows(raw_entities_path: Path) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    seen: set[str] = set()
    for row in read_csv_records(raw_entities_path):
        raw_url = str(row.get("url") or "")
        if "-lev3" not in raw_url and "-lev4" not in raw_url:
            continue
        fixed_url = normalize_historical_url(raw_url)
        if fixed_url in seen:
            continue
        seen.add(fixed_url)
        rows.append({
            "raw_url": raw_url,
            "fixed_url": fixed_url,
            "dtel": parse_dtel(raw_url),
        })
    return rows


def melt_tables(url: str, html_file: str, title: str, tables: List[pd.DataFrame]) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    for table_idx, df in enumerate(tables):
        chunk = df.copy()
        chunk.columns = [str(col) for col in chunk.columns]
        chunk["__table_idx"] = table_idx
        chunk["__url"] = url
        chunk["__html_file"] = html_file
        chunk["__title"] = title
        chunk = chunk.reset_index(drop=True)
        chunk["__rownum"] = chunk.index
        long_df = chunk.melt(
            id_vars=["__table_idx", "__url", "__html_file", "__title", "__rownum"],
            var_name="column_name",
            value_name="cell_value",
        )
        rows.extend(long_df.to_dict("records"))
    return rows


def repair_year_source(year: int, raw_entities_path: Path, source_root: Path, max_workers: int) -> Dict[str, object]:
    election_key = f"camera_{year}"
    status_dir = source_root / election_key
    clean_dir = source_root / f"{election_key}_clean"
    raw_dir = source_root / f"{election_key}_raw"
    pages_dir = raw_dir / "pages"
    status_dir.mkdir(parents=True, exist_ok=True)
    clean_dir.mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)

    candidates = municipality_candidate_rows(raw_entities_path)
    if not candidates:
        raise RuntimeError(f"Nessun candidato comunale storico trovato per {election_key}")

    table_index_rows: List[Dict[str, object]] = []
    turnout_rows: List[Dict[str, object]] = []
    tables_long_rows: List[Dict[str, object]] = []
    entity_rows: List[Dict[str, object]] = []
    failures: List[Dict[str, str]] = []

    def worker(item: Dict[str, str]) -> Tuple[Dict[str, object], Dict[str, object], List[Dict[str, object]], Dict[str, object]]:
        fixed_url = item["fixed_url"]
        html_file = url_html_file(fixed_url)
        cache_path = pages_dir / html_file
        if cache_path.exists():
            html = cache_path.read_text(encoding="utf-8", errors="replace")
        else:
            html = fetch_html(fixed_url)
            cache_path.write_text(html, encoding="utf-8")
        tables = safe_read_tables(html)
        entity = build_entity_record(fixed_url, html_file, html, tables)
        text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
        turnout = {
            "url": fixed_url,
            "html_file": html_file,
            "title": entity["title"],
            **find_turnout_numbers(text),
        }
        table_index = {"url": fixed_url, "html_file": html_file, "n_tables": len(tables)}
        tables_long = melt_tables(fixed_url, html_file, entity["title"], tables)
        return table_index, turnout, tables_long, entity

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(worker, item): item for item in candidates}
        for future in as_completed(future_map):
            item = future_map[future]
            try:
                table_index, turnout, long_rows, entity = future.result()
                table_index_rows.append(table_index)
                turnout_rows.append(turnout)
                tables_long_rows.extend(long_rows)
                entity_rows.append(entity)
            except Exception as exc:  # pragma: no cover - network variability
                failures.append({
                    "raw_url": item["raw_url"],
                    "fixed_url": item["fixed_url"],
                    "error": str(exc),
                })

    table_index_rows.sort(key=lambda row: row["url"])
    turnout_rows.sort(key=lambda row: row["url"])
    entity_rows.sort(key=lambda row: row["url"])
    tables_long_rows.sort(key=lambda row: (str(row["__url"]), int(row["__table_idx"]), int(row["__rownum"]), str(row["column_name"])))

    write_csv(clean_dir / "table_index.csv", TABLE_INDEX_COLUMNS, table_index_rows)
    write_csv(clean_dir / "turnout.csv", TURNOUT_COLUMNS, turnout_rows)
    write_csv(clean_dir / "tables_long.csv", TABLES_LONG_COLUMNS, tables_long_rows)
    write_csv(raw_dir / "entities.csv", ENTITY_COLUMNS, entity_rows)

    dtel = next((item["dtel"] for item in candidates if item["dtel"]), "")
    successful = len(table_index_rows)
    plausible = successful > 0 and len(failures) <= 2
    status = {
        "status": "completed" if plausible else "partial",
        "plausible": plausible,
        "strategy": "historical_grouped_url_repair",
        "trial_name": "historical_grouped_fixed",
        "dtel": dtel,
        "warning": "" if plausible else f"{len(failures)} fetch failures during historical grouped repair",
    }
    write_json(status_dir / "status.json", status)
    write_json(clean_dir / "summary.json", {
        "generated_by": "rebuild_historical_bundle_from_grouped.py",
        "candidate_count": len(candidates),
        "repaired_count": successful,
        "failed_count": len(failures),
    })
    if failures:
        write_json(status_dir / "repair_failures.json", failures)

    return {
        "election_key": election_key,
        "candidate_count": len(candidates),
        "repaired_count": successful,
        "failed_count": len(failures),
        "plausible": plausible,
    }


def combine_unique_rows(frame: pd.DataFrame, subset: List[str]) -> pd.DataFrame:
    if frame.empty:
        return frame
    return frame.drop_duplicates(subset=subset, keep="first").reset_index(drop=True)


def normalize_election_records(records: List[Dict[str, object]]) -> List[Dict[str, object]]:
    normalized: List[Dict[str, object]] = []
    for row in records:
        item = dict(row)
        year = item.get("election_year")
        try:
            item["election_year"] = int(str(year).strip())
        except Exception:
            item["election_year"] = year
        normalized.append(item)
    return normalized


def coerce_numeric_columns(frame: pd.DataFrame, columns: Iterable[str]) -> pd.DataFrame:
    out = frame.copy()
    for column in columns:
        if column in out.columns:
            out[column] = pd.to_numeric(out[column], errors="coerce")
    return out


def merge_historical_into_bundle(root: Path, historical_source_root: Path, repaired_summary: List[Dict[str, object]]) -> None:
    derived = root / "data" / "derived"
    preprocess.GEOMETRY_LOOKUP = preprocess.load_geometry_lookup(root / "data" / "reference")

    historical_elections = preprocess.infer_elections(historical_source_root)
    hist_summary, hist_results, _hist_muni, _hist_parties, _hist_lineage, _hist_aliases, extras = preprocess.parse_clean_payloads(historical_source_root, historical_elections)
    hist_keys = {row["election_key"] for row in historical_elections}

    current_summary = pd.read_csv(derived / "municipality_summary.csv", dtype=str).fillna("")
    current_results = pd.read_csv(derived / "municipality_results_long.csv", dtype=str).fillna("")
    current_elections = pd.read_csv(derived / "elections_master.csv", dtype=str).fillna("")

    summary_combined = pd.concat(
        [current_summary[~current_summary["election_key"].isin(hist_keys)], hist_summary.fillna("")],
        ignore_index=True,
        sort=False,
    )
    results_combined = pd.concat(
        [current_results[~current_results["election_key"].isin(hist_keys)], hist_results.fillna("")],
        ignore_index=True,
        sort=False,
    )
    summary_combined = combine_unique_rows(summary_combined, ["election_key", "municipality_id"])
    results_combined = combine_unique_rows(
        results_combined,
        ["election_key", "municipality_id", "party_std", "party_raw", "votes", "vote_share", "geometry_id"],
    )
    summary_combined = coerce_numeric_columns(
        summary_combined,
        ["election_year", "turnout_pct", "electors", "voters", "valid_votes", "total_votes", "first_party_share", "second_party_share", "first_second_margin"],
    )
    results_combined = coerce_numeric_columns(
        results_combined,
        ["election_year", "votes", "vote_share", "rank"],
    )

    historical_elections_df = pd.DataFrame(historical_elections).fillna("")
    all_elections = pd.concat(
        [current_elections[~current_elections["election_key"].isin(hist_keys)], historical_elections_df],
        ignore_index=True,
        sort=False,
    )
    all_elections = all_elections.sort_values(["election_year", "election_key"]).reset_index(drop=True)
    combined_election_records = normalize_election_records(all_elections.to_dict("records"))
    finalized_elections = preprocess.finalize_elections_master(combined_election_records, summary_combined, results_combined)
    finalized_elections = normalize_election_records(finalized_elections)

    municipalities, parties, lineage, aliases = preprocess.build_master_tables(summary_combined, results_combined, finalized_elections)

    quality_path = derived / "data_quality_report.json"
    if quality_path.exists():
        quality = json.loads(quality_path.read_text(encoding="utf-8"))
    else:
        quality = {}
    derived_validations = preprocess.validate_derived(summary_combined, results_combined)
    total_elections = max(len(finalized_elections), 1)
    summary_covered = summary_combined["election_key"].nunique() if not summary_combined.empty else 0
    result_covered = results_combined["election_key"].nunique() if not results_combined.empty else 0
    substantive_score = round(((summary_covered / total_elections) * 0.7 + (result_covered / total_elections) * 0.3) * 100)
    derived_validations["substantive_coverage_score"] = substantive_score
    quality["derived_validations"] = derived_validations
    quality["historical_rebuild"] = {
        "generated_by": "rebuild_historical_bundle_from_grouped.py",
        "version": CURRENT_VERSION,
        "years": HISTORICAL_YEARS,
        "repair_summary": repaired_summary,
    }

    geometry_info = preprocess.geometry_manifest_files(root)
    dataset_registry = preprocess.build_dataset_registry(root, finalized_elections, summary_combined, results_combined, quality)
    usage_notes = preprocess.build_usage_notes_payload(quality, geometry_info)
    provenance = preprocess.build_provenance_payload(root)
    entries = list(provenance.get("entries") or [])
    entries.append({
        "dataset_key": "historicalGroupedRepair",
        "path": "data/intermediate/historical_fixed_source",
        "produced_by": "rebuild_historical_bundle_from_grouped.py",
        "source_class": "repair_staging",
        "transformation_steps": [
            "lettura dei grouped storici con URL comunali ancora raw",
            "normalizzazione dei token archivio X-levkY nei parametri ne/lev",
            "refetch delle pagine comunali corrette e ricostruzione dei clean CSV storici",
            "fusione del bundle storico riparato con il bundle moderno già pubblicato"
        ],
        "limitations": [
            "dipende dal fetch live delle pagine storiche corrette del sito Archivio",
            "la copertura storica resta vincolata alla topologia comunale effettivamente esposta dall'Archivio"
        ]
    })
    provenance["entries"] = entries

    summary_combined = summary_combined[preprocess.CONTRACTS["municipality_summary.csv"]].fillna("")
    results_combined = results_combined[preprocess.CONTRACTS["municipality_results_long.csv"]].fillna("")
    municipalities = municipalities[preprocess.CONTRACTS["municipalities_master.csv"]].fillna("")
    parties = parties[preprocess.CONTRACTS["parties_master.csv"]].fillna("")
    lineage = lineage[preprocess.CONTRACTS["territorial_lineage.csv"]].fillna("")
    aliases = aliases[preprocess.CONTRACTS["municipality_aliases.csv"]].fillna("")

    summary_combined.to_csv(derived / "municipality_summary.csv", index=False)
    results_combined.to_csv(derived / "municipality_results_long.csv", index=False)
    municipalities.to_csv(derived / "municipalities_master.csv", index=False)
    parties.to_csv(derived / "parties_master.csv", index=False)
    lineage.to_csv(derived / "territorial_lineage.csv", index=False)
    aliases.to_csv(derived / "municipality_aliases.csv", index=False)
    pd.DataFrame(finalized_elections).to_csv(derived / "elections_master.csv", index=False)
    write_json(derived / "data_quality_report.json", quality)
    write_json(derived / "dataset_registry.json", dataset_registry)
    write_json(derived / "usage_notes.json", usage_notes)
    write_json(derived / "provenance.json", provenance)
    write_json(derived / "historical_rebuild_log.json", {
        "generated_by": "rebuild_historical_bundle_from_grouped.py",
        "version": CURRENT_VERSION,
        "repair_summary": repaired_summary,
        "historical_summary_rows": int(len(hist_summary)),
        "historical_result_rows": int(len(hist_results)),
    })


def run_subprocess(command: List[str], cwd: Path) -> None:
    completed = subprocess.run(command, cwd=str(cwd), check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}"
        )


def compare_and_import_gap_report(root: Path, pipeline_root: Path) -> None:
    compare_script = pipeline_root / "compare_camera_coverage.py"
    archive_manifest = pipeline_root / "out_camera_lombardia_archive" / "archive_manifest.json"
    import_script = root / "scripts" / "import_archive_gap_report.py"
    run_subprocess(
        [
            sys.executable,
            str(compare_script),
            "--archive-manifest",
            str(archive_manifest),
            "--bundle-root",
            str(root),
            "--out-json",
            str(DEFAULT_COMPARE_JSON),
            "--out-csv",
            str(DEFAULT_COMPARE_CSV),
        ],
        cwd=root,
    )
    run_subprocess(
        [
            sys.executable,
            str(import_script),
            "--root",
            str(root),
            "--source",
            str(DEFAULT_COMPARE_JSON),
        ],
        cwd=root,
    )


def source_path_for_year(pipeline_root: Path, year: int) -> Path:
    if year == 1953:
        return pipeline_root / "out_all_inclusive_v4" / "camera_1953_raw" / "entities.csv"
    return pipeline_root / "out_historical_grouped_batch" / f"camera_{year}" / "raw" / "entities.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair historical grouped years and merge them into the Electio Italia bundle.")
    parser.add_argument("--root", default=".", help="Project root of lombardia_camera_app_v35")
    parser.add_argument("--pipeline-root", default=str(DEFAULT_PIPELINE_ROOT), help="Root of camera_lombardia_only_suite_v5 pipeline artifacts")
    parser.add_argument("--source-root", default=str(DEFAULT_SOURCE_ROOT), help="Temporary repaired historical source root")
    parser.add_argument("--years", nargs="*", type=int, default=HISTORICAL_YEARS, help="Historical years to rebuild")
    parser.add_argument("--max-workers", type=int, default=MAX_WORKERS, help="Parallel fetch workers")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(args.root).resolve()
    pipeline_root = Path(args.pipeline_root).resolve()
    source_root = Path(args.source_root).resolve()
    years = [year for year in args.years if year in HISTORICAL_YEARS]
    if not years:
        raise SystemExit("Nessun anno storico valido richiesto.")

    if source_root.exists():
        shutil.rmtree(source_root)
    source_root.mkdir(parents=True, exist_ok=True)

    repaired_summary: List[Dict[str, object]] = []
    for year in years:
        raw_entities_path = source_path_for_year(pipeline_root, year)
        if not raw_entities_path.exists():
            raise FileNotFoundError(f"Raw entities non trovato per camera_{year}: {raw_entities_path}")
        repaired_summary.append(repair_year_source(year, raw_entities_path, source_root, args.max_workers))

    merge_historical_into_bundle(root, source_root, repaired_summary)
    run_subprocess([sys.executable, str(root / "scripts" / "build_result_shards.py"), "--root", str(root)], cwd=root)
    compare_and_import_gap_report(root, pipeline_root)

    print(json.dumps({
        "root": str(root),
        "version": CURRENT_VERSION,
        "years": years,
        "repair_summary": repaired_summary,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
