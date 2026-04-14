#!/usr/bin/env python3
from __future__ import annotations

import csv
import gzip
import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    derived = root / "data" / "derived"
    source_path = derived / "municipalities_master.csv"
    json_path = derived / "municipality_search_index.json"
    gzip_path = derived / "municipality_search_index.json.gz"
    manifest_path = derived / "manifest.json"

    rows: list[dict[str, str]] = []
    with source_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        for row in reader:
            municipality_id = (row.get("municipality_id") or "").strip()
            if not municipality_id:
                continue
            label = (row.get("name_current") or row.get("name_historical") or municipality_id).strip()
            province = (row.get("province_current") or row.get("province") or "").strip()
            geometry_id = (row.get("geometry_id") or municipality_id).strip()
            rows.append({
                "municipality_id": municipality_id,
                "label": label,
                "province": province,
                "geometry_id": geometry_id,
            })

    json_bytes = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_path.write_bytes(json_bytes)
    with gzip.open(gzip_path, "wb", compresslevel=9) as target:
        target.write(json_bytes)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.setdefault("files", {})["municipalitySearchIndex"] = "data/derived/municipality_search_index.json.gz"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "rows": len(rows),
        "json": str(json_path.relative_to(root)).replace("\\", "/"),
        "gzip": str(gzip_path.relative_to(root)).replace("\\", "/"),
        "json_bytes": json_path.stat().st_size,
        "gzip_bytes": gzip_path.stat().st_size,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
