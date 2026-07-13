#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
from pathlib import Path

from build_result_shards import summarize_file


def gzip_file(path: Path, *, force: bool = True) -> Path:
    if path.suffix.lower() == ".gz":
        return path
    out_path = path.with_name(path.name + ".gz")
    if not force and out_path.exists() and out_path.stat().st_mtime >= path.stat().st_mtime:
        return out_path
    with path.open("rb") as source, out_path.open("wb") as raw_target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_target, compresslevel=9, mtime=0) as target:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
    return out_path


def rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def uncompressed_source(path_rel: str, root: Path) -> Path:
    path = root / path_rel
    if path.suffix.lower() != ".gz":
        return path
    candidate = path.with_suffix("")
    if candidate.exists():
        return candidate
    raise FileNotFoundError(f"Missing uncompressed source for {path_rel}: {candidate}")


def gz_rel(path_rel: str, root: Path) -> str:
    path = uncompressed_source(path_rel, root)
    return rel(gzip_file(path), root)


def gzip_shards(index_path: Path, root: Path) -> dict[str, object]:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    shards = index.get("shards_uncompressed") or index.get("shards") or {}
    compressed = {}
    uncompressed = {}
    original_bytes = 0
    compressed_bytes = 0
    for key, shard_rel in shards.items():
        shard_path = uncompressed_source(shard_rel, root)
        gz_path = gzip_file(shard_path)
        original_bytes += shard_path.stat().st_size
        compressed_bytes += gz_path.stat().st_size
        uncompressed[key] = rel(shard_path, root)
        compressed[key] = rel(gz_path, root)
    index["shards_uncompressed"] = uncompressed
    index["shards"] = compressed
    index["compression"] = {
        "format": "gzip",
        "original_bytes": original_bytes,
        "compressed_bytes": compressed_bytes,
        "reduction_pct": round(100 * (1 - compressed_bytes / original_bytes), 2) if original_bytes else 0,
    }
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index["compression"]


def refresh_product_manifests(root: Path) -> None:
    catalog_path = root / "data/products/product_catalog.json"
    if not catalog_path.exists():
        return
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    for product in catalog.get("products") or []:
        manifest_rel = product.get("manifest_path")
        if not manifest_rel or not (root / manifest_rel).exists():
            continue
        manifest_path = root / manifest_rel
        product_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        by_path = {}
        for dataset in product_manifest.get("datasets") or []:
            path_rel = dataset.get("path")
            if not path_rel or not (root / path_rel).exists():
                continue
            meta = summarize_file(root / path_rel, root)
            for key in ["kind", "size_bytes", "row_count", "feature_count", "sha256"]:
                dataset[key] = meta.get(key)
            by_path[path_rel] = meta
        for entry in (product_manifest.get("inventory") or {}).get("entries") or []:
            path_rel = entry.get("path")
            meta = by_path.get(path_rel) if path_rel else None
            if not meta and path_rel and (root / path_rel).exists():
                meta = summarize_file(root / path_rel, root)
            if not meta:
                continue
            for key in ["kind", "size_bytes", "row_count", "feature_count"]:
                if key in entry or key in {"kind", "size_bytes", "row_count"}:
                    entry[key] = meta.get(key)
        manifest_path.write_text(json.dumps(product_manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    derived = root / "data/derived"

    geometry_pack_path = derived / "geometry_pack_web.json"
    geometry_pack = json.loads(geometry_pack_path.read_text(encoding="utf-8"))
    geometry_compression = []
    for family in ["municipalities", "provinces"]:
        for year, path_rel in list((geometry_pack.get(family) or {}).items()):
            source = uncompressed_source(path_rel, root)
            gz_path = gzip_file(source)
            geometry_pack[family][year] = rel(gz_path, root)
            geometry_compression.append({
                "family": family,
                "year": year,
                "source": path_rel,
                "gzip": rel(gz_path, root),
                "original_bytes": source.stat().st_size,
                "compressed_bytes": gz_path.stat().st_size,
            })
    geometry_pack["compression"] = {
        "format": "gzip",
        "rows": geometry_compression,
    }
    geometry_pack_path.write_text(json.dumps(geometry_pack, ensure_ascii=False, indent=2), encoding="utf-8")

    summary_compression = gzip_shards(derived / "municipality_summary_by_election.json", root)
    results_compression = gzip_shards(derived / "municipality_results_long_by_election.json", root)

    report_path = derived / "web_compression_report.json"
    report_path.write_text(json.dumps({
        "generated_by": "build_web_compressed_assets.py",
        "geometry": geometry_compression,
        "summary_shards": summary_compression,
        "result_shards": results_compression,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    refresh_product_manifests(root)

    manifest_path = derived / "manifest.json"
    release_path = derived / "release_manifest.json"
    if manifest_path.exists() and release_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        release = json.loads(release_path.read_text(encoding="utf-8"))
        entries = release.setdefault("file_entries", {})
        for key, relative_path in (manifest.get("files") or {}).items():
            if key != "releaseManifest" and (root / relative_path).exists():
                entries[key] = summarize_file(root / relative_path, root)
        for key, entry in list(entries.items()):
            relative_path = entry.get("path") if isinstance(entry, dict) else ""
            if str(key).startswith("productManifest:") and relative_path and (root / relative_path).exists():
                entries[key] = summarize_file(root / relative_path, root)
        release["project"] = manifest.get("project") or release.get("project") or {}
        release["integrity"] = {
            "sha256_scope": sorted(entries),
            "all_declared_files_present": all(
                (root / relative_path).exists()
                for key, relative_path in (manifest.get("files") or {}).items()
                if key != "releaseManifest"
            ),
        }
        release_path.write_text(json.dumps(release, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report_path)


if __name__ == "__main__":
    main()
