#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def rows_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    return []


def require(condition: bool, issue: str, issues: list[str]) -> None:
    if not condition:
        issues.append(issue)


def resolve(root: Path, rel: str | None) -> Path:
    return root / str(rel or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke checks for the fast map/data loading architecture.")
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--sample-election", default="camera_2022", help="Election shard to sample")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    derived = root / "data" / "derived"
    issues: list[str] = []
    facts: dict[str, Any] = {}

    manifest_path = derived / "manifest.json"
    require(manifest_path.exists(), "manifest:missing", issues)
    manifest = read_json(manifest_path) if manifest_path.exists() else {}
    files = manifest.get("files") or {}
    loading = manifest.get("loading") or {}

    for dataset in ["municipalitySummary", "municipalityResultsLong", "mapReady"]:
        strategy = loading.get(dataset, {}).get("strategy")
        require(strategy == "deferred_by_election", f"loading:{dataset}:expected_deferred_by_election", issues)

    search_path = resolve(root, files.get("municipalitySearchIndex"))
    require(search_path.exists(), f"municipality_search_index:missing:{search_path}", issues)
    if search_path.exists():
        search_rows = rows_from_payload(read_json(search_path))
        facts["municipality_search_rows"] = len(search_rows)
        required = {"municipality_id", "label", "province", "geometry_id"}
        require(bool(search_rows), "municipality_search_index:empty", issues)
        require(required.issubset(search_rows[0].keys()), "municipality_search_index:missing_required_fields", issues)

    map_ready_index_path = resolve(root, files.get("mapReadyByElectionIndex"))
    require(map_ready_index_path.exists(), f"map_ready_index:missing:{map_ready_index_path}", issues)
    if map_ready_index_path.exists():
        index = read_json(map_ready_index_path)
        shards = index.get("shards") or {}
        require(index.get("strategy") == "by_election", "map_ready_index:strategy_not_by_election", issues)
        require(bool(shards), "map_ready_index:no_shards", issues)
        sample_key = args.sample_election if args.sample_election in shards else (sorted(shards) or [""])[-1]
        sample_path = resolve(root, shards.get(sample_key))
        require(sample_path.exists(), f"map_ready_shard:missing:{sample_key}:{sample_path}", issues)
        if sample_path.exists():
            map_rows = rows_from_payload(read_json(sample_path))
            facts["map_ready_sample"] = sample_key
            facts["map_ready_rows"] = len(map_rows)
            require(bool(map_rows), f"map_ready_shard:empty:{sample_key}", issues)
            if map_rows:
                row = map_rows[0]
                required_row_fields = {
                    "election_key",
                    "municipality_id",
                    "turnout_pct",
                    "first_party_std",
                    "first_second_margin",
                    "dominant_block",
                    "shares",
                }
                require(required_row_fields.issubset(row.keys()), f"map_ready_shard:missing_fields:{sample_key}", issues)
                shares = row.get("shares") or {}
                for mode in ["party_std", "party_family", "bloc"]:
                    require(isinstance(shares.get(mode), dict) and bool(shares.get(mode)), f"map_ready_shard:missing_shares:{mode}", issues)

    geometry_pack_path = resolve(root, files.get("geometryPack"))
    require(geometry_pack_path.exists(), f"geometry_pack:missing:{geometry_pack_path}", issues)
    if geometry_pack_path.exists():
        pack = read_json(geometry_pack_path)
        years = [str(year) for year in pack.get("availableYears") or []]
        facts["geometry_years"] = years
        require(bool(years), "geometry_pack:no_years", issues)
        for year in years:
            overview_path = resolve(root, (pack.get("municipalities") or {}).get(year))
            boundary_path = resolve(root, (pack.get("municipalityBoundaries") or {}).get(year))
            province_path = resolve(root, (pack.get("provinces") or {}).get(year))
            detail = (pack.get("detailMunicipalities") or {}).get(year) or {}
            require(overview_path.exists(), f"geometry_pack:missing_overview:{year}:{overview_path}", issues)
            require(boundary_path.exists(), f"geometry_pack:missing_boundary_mesh:{year}:{boundary_path}", issues)
            require(province_path.exists(), f"geometry_pack:missing_provinces:{year}:{province_path}", issues)
            require(bool(detail), f"geometry_pack:missing_detail_chunks:{year}", issues)
            if boundary_path.exists():
                boundary = read_json(boundary_path)
                features = boundary.get("features") or []
                require(len(features) == 1, f"boundary_mesh:expected_single_feature:{year}", issues)
                require(features and features[0].get("geometry", {}).get("type") == "MultiLineString", f"boundary_mesh:not_multilinestring:{year}", issues)
            if detail:
                province, rel = sorted(detail.items())[0]
                detail_path = resolve(root, rel)
                require(detail_path.exists(), f"detail_chunk:missing:{year}:{province}:{detail_path}", issues)
                if detail_path.exists():
                    chunk = read_json(detail_path)
                    require(bool(chunk.get("features")), f"detail_chunk:empty:{year}:{province}", issues)

    selectors_text = (root / "modules" / "selectors.js").read_text(encoding="utf-8")
    app_text = (root / "app.js").read_text(encoding="utf-8")
    map_module_path = root / "modules" / "features" / "map.js"
    tooltip_module_path = root / "modules" / "features" / "map-tooltip.js"
    require(map_module_path.exists(), "map_module:missing", issues)
    require(tooltip_module_path.exists(), "map_tooltip_module:missing", issues)
    map_module_text = map_module_path.read_text(encoding="utf-8") if map_module_path.exists() else ""
    tooltip_module_text = tooltip_module_path.read_text(encoding="utf-8") if tooltip_module_path.exists() else ""
    require("party_share" in selectors_text and "MAP_READY_METRICS" in selectors_text, "selectors:party_share_not_declared_map_ready", issues)
    require("shouldUseMapReadyRows" in selectors_text and "state.mapReadyRows" in selectors_text, "selectors:missing_map_ready_selection_path", issues)
    require("scheduleDetailGeometryPrefetch" in app_text and "pumpDetailGeometryPrefetch" in app_text, "app:missing_detail_prefetch_queue", issues)
    require("scheduleMunicipalityBoundaryGeometryLoad" in app_text, "app:missing_boundary_mesh_loader", issues)
    require("buildCanvasMapCache" in map_module_text and "hitTestCanvasMap" in map_module_text and "drawCanvasMap" in map_module_text and "renderCanvasMap" in map_module_text, "map_module:missing_canvas_exports", issues)
    require("createMapTooltipController" in tooltip_module_text and "scheduleHoverTooltip" in tooltip_module_text, "map_tooltip_module:missing_hover_exports", issues)
    require("createMapTooltipController" in app_text and "map-tooltip.js" in app_text, "app:missing_map_tooltip_controller", issues)

    print(json.dumps({
        "root": str(root),
        "facts": facts,
        "issues": issues,
        "ok": not issues,
    }, ensure_ascii=False, indent=2))
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
