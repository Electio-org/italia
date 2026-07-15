#!/usr/bin/env python3
"""Download and inventory official Eligendo European-election archives."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import requests


BASE_DOWNLOAD_URL = "https://dait.interno.gov.it/documenti/opendata"
UA = "Electio-Italia European archive sync/1.0"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_complete_zip(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        with ZipFile(path) as archive:
            return archive.testzip() is None
    except BadZipFile:
        return False


def download_archive(session: requests.Session, url: str, target: Path) -> None:
    if is_complete_zip(target):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = target.stat().st_size if target.exists() else 0
    headers = {"User-Agent": UA}
    if existing:
        headers["Range"] = f"bytes={existing}-"
    with session.get(url, headers=headers, timeout=(30, 180), stream=True) as response:
        response.raise_for_status()
        append = existing > 0 and response.status_code == 206
        mode = "ab" if append else "wb"
        with target.open(mode) as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    if not is_complete_zip(target):
        raise RuntimeError(f"Incomplete archive after download: {target}")


def european_inventory(root: Path) -> list[dict[str, object]]:
    inventory_path = root / "data" / "derived" / "sources_inventory_extended.json"
    payload = json.loads(inventory_path.read_text(encoding="utf-8"))
    family = next((row for row in payload.get("families") or [] if row.get("family") == "europee"), None)
    if not family:
        raise RuntimeError("European archive family missing from sources inventory")
    return list(family.get("items") or [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--dest-dir", default="source_cache/european_archives")
    parser.add_argument("--manifest-out", default="data/reference/european_opendata_archives_manifest.json")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    dest = root / args.dest_dir
    session = requests.Session()
    session.trust_env = False
    entries = []
    for item in european_inventory(root):
        relative_path = str(item.get("relative_path") or f"europee/{item['filename']}")
        url = f"{BASE_DOWNLOAD_URL}/{relative_path}"
        target = dest / str(item["filename"])
        print(f"sync {item['election_key']} -> {target.name}", flush=True)
        download_archive(session, url, target)
        with ZipFile(target) as archive:
            members = archive.namelist()
        entries.append({
            "election_type": "europee",
            "election_key": item["election_key"],
            "year": int(item["year"]),
            "election_date": item.get("election_date_iso") or "",
            "filename": target.name,
            "relative_path": relative_path,
            "download_url": url,
            "local_path": str(target.relative_to(root)).replace("\\", "/"),
            "size_bytes": target.stat().st_size,
            "sha256": sha256_file(target),
            "members": members,
        })
    output = root / args.manifest_out
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "generated_by": "scripts/sync_european_opendata_archives.py",
        "source": "Eligendo open data - Ministero dell'Interno",
        "archive_count": len(entries),
        "entries": entries,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"European archive manifest: {output} ({len(entries)} archives)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
