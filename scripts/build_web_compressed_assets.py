#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
from pathlib import Path


def gzip_file(path: Path, *, force: bool = True) -> Path:
    out_path = path.with_name(path.name + ".gz")
    if not force and out_path.exists() and out_path.stat().st_mtime >= path.stat().st_mtime:
        return out_path
    with path.open("rb") as source, gzip.open(out_path, "wb", compresslevel=9) as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            target.write(chunk)
    return out_path


def rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def gz_rel(path_rel: str, root: Path) -> str:
    path = root / path_rel
    return rel(gzip_file(path), root)


def uncompressed_rel(path_rel: str, root: Path) -> str:
    path_rel = str(path_rel)
    if path_rel.endswith(".gz") and (root / path_rel[:-3]).exists():
        return path_rel[:-3]
    return path_rel


def gzip_geometry_rel(path_rel: str, root: Path) -> tuple[str, str, int, int]:
    source_rel = uncompressed_rel(path_rel, root)
    source = root / source_rel
    if source_rel.endswith(".gz"):
        gz_path = source
        source_for_size = root / source_rel[:-3] if (root / source_rel[:-3]).exists() else source
    else:
        gz_path = gzip_file(source)
        source_for_size = source
    return source_rel, rel(gz_path, root), source_for_size.stat().st_size, gz_path.stat().st_size


def gzip_shards(index_path: Path, root: Path) -> dict[str, object]:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    shards = index.get("shards_uncompressed") or index.get("shards") or {}
    shards = {key: uncompressed_rel(path, root) for key, path in shards.items()}
    compressed = {}
    original_bytes = 0
    compressed_bytes = 0
    for key, shard_rel in shards.items():
        source_rel, gz_path_rel, source_bytes, gz_bytes = gzip_geometry_rel(shard_rel, root)
        shards[key] = source_rel
        original_bytes += source_bytes
        compressed_bytes += gz_bytes
        compressed[key] = gz_path_rel
    index["shards_uncompressed"] = shards
    index["shards"] = compressed
    index["compression"] = {
        "format": "gzip",
        "original_bytes": original_bytes,
        "compressed_bytes": compressed_bytes,
        "reduction_pct": round(100 * (1 - compressed_bytes / original_bytes), 2) if original_bytes else 0,
    }
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index["compression"]


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    derived = root / "data/derived"

    geometry_pack_path = derived / "geometry_pack_web.json"
    geometry_pack = json.loads(geometry_pack_path.read_text(encoding="utf-8"))
    geometry_compression = []
    for family in ["municipalities", "provinces"]:
        for year, path_rel in list((geometry_pack.get(family) or {}).items()):
            source_rel, gz_path_rel, original_bytes, compressed_bytes = gzip_geometry_rel(path_rel, root)
            geometry_pack[family][year] = gz_path_rel
            geometry_compression.append({
                "family": family,
                "year": year,
                "source": source_rel,
                "gzip": gz_path_rel,
                "original_bytes": original_bytes,
                "compressed_bytes": compressed_bytes,
            })
    for year, province_paths in list((geometry_pack.get("detailMunicipalities") or {}).items()):
        compressed_province_paths = {}
        for province, path_rel in list((province_paths or {}).items()):
            source_rel, gz_path_rel, original_bytes, compressed_bytes = gzip_geometry_rel(path_rel, root)
            compressed_province_paths[province] = gz_path_rel
            geometry_compression.append({
                "family": "detailMunicipalities",
                "year": year,
                "province": province,
                "source": source_rel,
                "gzip": gz_path_rel,
                "original_bytes": original_bytes,
                "compressed_bytes": compressed_bytes,
            })
        geometry_pack.setdefault("detailMunicipalities", {})[year] = compressed_province_paths
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
    print(report_path)


if __name__ == "__main__":
    main()
