#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List
from zipfile import ZipFile

import requests


OPEN_DATA_URL = "https://elezionistorico.interno.gov.it/eligendo/opendata.php"
BASE_DOWNLOAD_URL = "https://elezionistorico.interno.gov.it"
DEFAULT_DEST = Path(r"D:\camera_lombardia_only_suite_v5\opendata_camera_archives")
DEFAULT_MANIFEST = Path(r"D:\camera_lombardia_only_suite_v5\lombardia_camera_app_v35\data\reference\camera_opendata_archives_manifest.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def fetch_page(url: str) -> str:
    session = requests.Session()
    session.trust_env = False
    response = session.get(url, headers={"User-Agent": UA}, timeout=30)
    response.raise_for_status()
    response.encoding = response.encoding or "utf-8"
    return response.text


SUPPORTED_TYPES = {"camera", "assemblea_costituente"}


def parse_consultation_entries(html: str) -> List[Dict[str, str]]:
    rows = re.findall(
        r'\[\s*"(?P<etype>camera|assemblea_costituente)",\s*"(?P<year>\d{4})",\s*"(?P<rel>[^"]+)",\s*"(?P<name>[^"]+\.zip)",\s*"(?P<date>[^"]+)"',
        html,
        flags=re.I,
    )
    entries: List[Dict[str, str]] = []
    seen = set()
    for election_type, year, rel, name, date in rows:
        election_type = election_type.lower()
        if election_type not in SUPPORTED_TYPES:
            continue
        if name in seen:
            continue
        seen.add(name)
        entries.append(
            {
                "election_type": election_type,
                "year": year,
                "election_date": date,
                "relative_path": rel,
                "filename": name,
                "download_url": f"{BASE_DOWNLOAD_URL}/daithome/documenti/opendata/{rel}",
            }
        )
    return sorted(entries, key=lambda row: (int(row["year"]), str(row["election_type"])))


def download_file(url: str, target: Path) -> Dict[str, object]:
    if target.exists() and target.stat().st_size > 0:
        return {"downloaded": False, "size_bytes": target.stat().st_size}
    target.parent.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.trust_env = False
    with session.get(url, headers={"User-Agent": UA}, timeout=60, stream=True) as response:
        response.raise_for_status()
        with target.open("wb") as fh:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    fh.write(chunk)
    return {"downloaded": True, "size_bytes": target.stat().st_size}


def inspect_zip(path: Path) -> Dict[str, object]:
    with ZipFile(path) as archive:
        names = archive.namelist()
    return {
        "entry_count": len(names),
        "members": names,
        "csv_members": [name for name in names if name.lower().endswith(".csv")],
        "xlsx_members": [name for name in names if name.lower().endswith(".xlsx")],
    }


def write_manifest(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download and inventory Lombardia bundle open-data zip archives from Eligendo Archivio.")
    parser.add_argument("--dest-dir", default=str(DEFAULT_DEST), help="Directory where zip archives are stored")
    parser.add_argument("--manifest-out", default=str(DEFAULT_MANIFEST), help="Path to manifest JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dest_dir = Path(args.dest_dir).resolve()
    manifest_out = Path(args.manifest_out).resolve()

    html = fetch_page(OPEN_DATA_URL)
    entries = parse_consultation_entries(html)
    inventory: List[Dict[str, object]] = []
    for entry in entries:
        local_path = dest_dir / entry["filename"]
        download_meta = download_file(entry["download_url"], local_path)
        zip_meta = inspect_zip(local_path)
        inventory.append(
            {
                **entry,
                "local_path": str(local_path),
                "size_bytes": int(download_meta["size_bytes"]),
                "downloaded_now": bool(download_meta["downloaded"]),
                **zip_meta,
            }
        )

    payload = {
        "generated_by": "sync_camera_opendata_archives.py",
        "source_url": OPEN_DATA_URL,
        "archive_dir": str(dest_dir),
        "count": len(inventory),
        "entries": inventory,
    }
    write_manifest(manifest_out, payload)
    print(json.dumps({"count": len(inventory), "archive_dir": str(dest_dir), "manifest": str(manifest_out)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
