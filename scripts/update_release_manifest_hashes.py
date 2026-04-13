#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize(path: Path, root: Path, existing: dict[str, Any]) -> dict[str, Any]:
    info = dict(existing)
    rel = str(path.relative_to(root)).replace("\\", "/") if path.exists() else str(path).replace("\\", "/")
    info["path"] = rel
    info["kind"] = path.suffix.lower().lstrip(".") or "file"
    info["size_bytes"] = path.stat().st_size if path.exists() else 0
    info["sha256"] = sha256_file(path) if path.exists() else ""

    # Drop derived shape summaries before recomputing them. This keeps stale
    # counts from surviving after geometry/index regeneration.
    for key in ["row_count", "columns", "feature_count", "dataset_count", "product_count", "entry_count"]:
        info.pop(key, None)

    if not path.exists():
        return info

    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            count = 0
            columns = list(reader.fieldnames or [])
            for count, _row in enumerate(reader, start=1):
                pass
        info["row_count"] = count
        info["columns"] = columns
    elif suffix in {".json", ".geojson"}:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
        if isinstance(payload, dict):
            if isinstance(payload.get("features"), list):
                info["feature_count"] = len(payload["features"])
            elif isinstance(payload.get("datasets"), list):
                info["dataset_count"] = len(payload["datasets"])
            elif isinstance(payload.get("products"), list):
                info["product_count"] = len(payload["products"])
            elif isinstance(payload.get("entries"), list):
                info["entry_count"] = len(payload["entries"])
            elif isinstance(payload.get("shards"), dict):
                info["shard_count"] = len(payload["shards"])
    return info


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh release_manifest.json file sizes and SHA-256 values.")
    parser.add_argument("--root", default=".", help="Project root")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    release_path = root / "data" / "derived" / "release_manifest.json"
    if not release_path.exists():
        raise SystemExit(f"release manifest not found: {release_path}")

    release = json.loads(release_path.read_text(encoding="utf-8-sig"))
    file_entries = release.get("file_entries") or {}
    manifest_path = root / "data" / "derived" / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        for key, rel in (manifest.get("files") or {}).items():
            if key == "releaseManifest" or key in file_entries or not rel:
                continue
            file_entries[key] = {"path": rel}
    refreshed: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    for key, entry in file_entries.items():
        rel = entry.get("path")
        if not rel:
            refreshed[key] = dict(entry)
            missing.append(key)
            continue
        path = root / rel
        if not path.exists():
            missing.append(key)
        refreshed[key] = summarize(path, root, dict(entry))

    release["file_entries"] = refreshed
    integrity = release.setdefault("integrity", {})
    integrity["sha256_scope"] = sorted(refreshed)
    integrity["all_declared_files_present"] = not missing
    if missing:
        integrity["missing_declared_files"] = sorted(missing)
    else:
        integrity.pop("missing_declared_files", None)

    release_path.write_text(json.dumps(release, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
