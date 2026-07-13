#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Dict


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize_csv(path: Path, info: Dict[str, object]) -> None:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        headers = next(reader, [])
        info["columns"] = headers
        info["row_count"] = sum(1 for _ in reader)


def summarize_json(path: Path, info: Dict[str, object]) -> None:
    if path.stat().st_size > 25 * 1024 * 1024:
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return
    if isinstance(payload.get("features"), list):
        info["feature_count"] = len(payload["features"])
    elif isinstance(payload.get("objects"), dict):
        first = next(iter(payload["objects"].values()), None)
        if isinstance(first, dict) and isinstance(first.get("geometries"), list):
            info["feature_count"] = len(first["geometries"])
    for key, label in (("datasets", "dataset_count"), ("products", "product_count"), ("entries", "entry_count")):
        if isinstance(payload.get(key), list):
            info[label] = len(payload[key])


def summarize_file(path: Path, root: Path) -> Dict[str, object]:
    relative = str(path.relative_to(root)).replace("\\", "/")
    info: Dict[str, object] = {
        "path": relative,
        "kind": path.suffix.lower().lstrip(".") or "file",
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    suffix = path.suffix.lower()
    if suffix == ".csv":
        summarize_csv(path, info)
    elif suffix in {".json", ".geojson", ".topojson"}:
        summarize_json(path, info)
    return info


def refresh_release_manifest(root: Path) -> Path:
    derived = root / "data" / "derived"
    manifest = json.loads((derived / "manifest.json").read_text(encoding="utf-8"))
    entries = {}
    missing = []
    for key, relative in sorted((manifest.get("files") or {}).items()):
        if key == "releaseManifest":
            continue
        path = root / str(relative)
        if not path.exists():
            missing.append(str(relative))
            continue
        entries[key] = summarize_file(path, root)

    catalog_path = root / str((manifest.get("files") or {}).get("productCatalog") or "data/products/product_catalog.json")
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        for product in catalog.get("products") or []:
            product_key = str(product.get("product_key") or "").strip()
            relative = str(product.get("manifest_path") or "").strip()
            path = root / relative
            if not product_key or not relative or not path.exists():
                if relative:
                    missing.append(relative)
                continue
            entries[f"productManifest:{product_key}"] = summarize_file(path, root)

    payload = {
        "generated_by": "refresh_release_manifest.py",
        "project": manifest.get("project") or {},
        "bundle_root": ".",
        "file_entries": entries,
        "integrity": {
            "sha256_scope": sorted(entries.keys()),
            "all_declared_files_present": not missing,
            "missing_files": sorted(set(missing)),
        },
    }
    output = derived / "release_manifest.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh release hashes and file metadata.")
    parser.add_argument("--root", default=".", help="Project root")
    args = parser.parse_args()
    output = refresh_release_manifest(Path(args.root).resolve())
    print(output)


if __name__ == "__main__":
    main()
