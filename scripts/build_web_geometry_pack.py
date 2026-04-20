#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from typing import DefaultDict, Dict, Iterable, List, Sequence, Set, Tuple


Point = Sequence[float]
RoundedPoint = Tuple[float, float]
SegmentKey = Tuple[RoundedPoint, RoundedPoint]


def sq_dist(a: Point, b: Point) -> float:
    dx = float(a[0]) - float(b[0])
    dy = float(a[1]) - float(b[1])
    return dx * dx + dy * dy


def sq_seg_dist(point: Point, start: Point, end: Point) -> float:
    x = float(start[0])
    y = float(start[1])
    dx = float(end[0]) - x
    dy = float(end[1]) - y
    if dx != 0 or dy != 0:
        t = ((float(point[0]) - x) * dx + (float(point[1]) - y) * dy) / (dx * dx + dy * dy)
        if t > 1:
            x = float(end[0])
            y = float(end[1])
        elif t > 0:
            x += dx * t
            y += dy * t
    dx = float(point[0]) - x
    dy = float(point[1]) - y
    return dx * dx + dy * dy


def simplify_radial(points: List[Point], sq_tolerance: float) -> List[Point]:
    if len(points) <= 2:
        return points[:]
    prev = points[0]
    new_points = [prev]
    for point in points[1:]:
        if sq_dist(point, prev) > sq_tolerance:
            new_points.append(point)
            prev = point
    if new_points[-1] != points[-1]:
        new_points.append(points[-1])
    return new_points


def simplify_douglas_peucker(points: List[Point], sq_tolerance: float) -> List[Point]:
    length = len(points)
    if length <= 2:
        return points[:]
    markers = [False] * length
    markers[0] = True
    markers[-1] = True
    stack: List[Tuple[int, int]] = [(0, length - 1)]
    while stack:
        first, last = stack.pop()
        max_sq_dist = 0.0
        index = 0
        for i in range(first + 1, last):
            dist = sq_seg_dist(points[i], points[first], points[last])
            if dist > max_sq_dist:
                index = i
                max_sq_dist = dist
        if max_sq_dist > sq_tolerance:
            markers[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [point for idx, point in enumerate(points) if markers[idx]]


def simplify_line(points: List[Point], tolerance: float) -> List[List[float]]:
    if len(points) <= 2:
        return [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in points]
    sq_tolerance = tolerance * tolerance
    simplified = simplify_radial(points, sq_tolerance)
    simplified = simplify_douglas_peucker(simplified, sq_tolerance)
    return [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in simplified]


def simplify_ring(points: List[Point], tolerance: float) -> List[List[float]]:
    if len(points) <= 4:
        return [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in points]
    closed = points[0] == points[-1]
    body = points[:-1] if closed else points[:]
    simplified = simplify_line(body, tolerance)
    if len(simplified) < 3:
        simplified = [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in body[:3]]
    simplified.append(simplified[0][:])
    while len(simplified) < 4:
        simplified.insert(-1, simplified[-2][:])
    return simplified


def simplify_polygon(polygons: Iterable[Iterable[Point]], tolerance: float) -> List[List[List[float]]]:
    return [simplify_ring(list(ring), tolerance) for ring in polygons]


def simplify_geometry(geometry: Dict[str, object], tolerance: float) -> Dict[str, object]:
    if not geometry:
        return geometry
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "Polygon":
        return {"type": "Polygon", "coordinates": simplify_polygon(coords or [], tolerance)}
    if geom_type == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [simplify_polygon(polygon, tolerance) for polygon in (coords or [])]}
    if geom_type == "LineString":
        return {"type": "LineString", "coordinates": simplify_line(list(coords or []), tolerance)}
    if geom_type == "MultiLineString":
        return {"type": "MultiLineString", "coordinates": [simplify_line(list(line), tolerance) for line in (coords or [])]}
    return deepcopy(geometry)


def feature_point_count(feature: Dict[str, object]) -> int:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates")
    if not coords:
        return 0
    geom_type = geometry.get("type")
    if geom_type == "Polygon":
        return sum(len(ring) for ring in coords)
    if geom_type == "MultiPolygon":
        return sum(len(ring) for polygon in coords for ring in polygon)
    if geom_type == "LineString":
        return len(coords)
    if geom_type == "MultiLineString":
        return sum(len(line) for line in coords)
    return 0


def rounded_point(point: Point) -> RoundedPoint:
    return (round(float(point[0]), 1), round(float(point[1]), 1))


def segment_key(a: RoundedPoint, b: RoundedPoint) -> SegmentKey:
    return (a, b) if a <= b else (b, a)


def iter_geometry_rings(geometry: Dict[str, object]) -> Iterable[List[Point]]:
    if not geometry:
        return
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if geom_type == "Polygon":
        for ring in coords:
            yield list(ring)
    elif geom_type == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                yield list(ring)


def build_boundary_lines(features: List[Dict[str, object]], tolerance: float) -> Tuple[List[List[List[float]]], int, int, int]:
    adjacency: DefaultDict[RoundedPoint, Set[RoundedPoint]] = defaultdict(set)
    raw_segments = 0
    for feature in features:
        for ring in iter_geometry_rings(feature.get("geometry") or {}):
            if len(ring) < 2:
                continue
            rounded = [rounded_point(point) for point in ring]
            for a, b in zip(rounded, rounded[1:]):
                if a == b:
                    continue
                adjacency[a].add(b)
                adjacency[b].add(a)
                raw_segments += 1

    visited: Set[SegmentKey] = set()
    lines: List[List[RoundedPoint]] = []

    def walk_line(start: RoundedPoint, neighbor: RoundedPoint) -> List[RoundedPoint]:
        line = [start, neighbor]
        visited.add(segment_key(start, neighbor))
        previous = start
        current = neighbor
        while True:
            if current == start:
                break
            current_neighbors = sorted(adjacency[current])
            if len(current_neighbors) != 2:
                break
            candidates = [
                candidate
                for candidate in current_neighbors
                if candidate != previous and segment_key(current, candidate) not in visited
            ]
            if not candidates:
                break
            next_point = candidates[0]
            visited.add(segment_key(current, next_point))
            line.append(next_point)
            previous, current = current, next_point
        return line

    for start in sorted(adjacency):
        if len(adjacency[start]) == 2:
            continue
        for neighbor in sorted(adjacency[start]):
            if segment_key(start, neighbor) in visited:
                continue
            lines.append(walk_line(start, neighbor))

    for start in sorted(adjacency):
        for neighbor in sorted(adjacency[start]):
            if segment_key(start, neighbor) in visited:
                continue
            lines.append(walk_line(start, neighbor))

    simplified_lines: List[List[List[float]]] = []
    for line in lines:
        if len(line) < 2:
            continue
        simplified = simplify_ring(line, tolerance) if len(line) >= 4 and line[0] == line[-1] else simplify_line(line, tolerance)
        if len(simplified) >= 2:
            simplified_lines.append(simplified)
    before_points = sum(len(line) for line in lines)
    after_points = sum(len(line) for line in simplified_lines)
    return simplified_lines, raw_segments, before_points, after_points


def write_boundary_mesh(
    path: Path,
    out_path: Path,
    bundle_root: Path,
    year_key: str,
    tolerance: float,
) -> Dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features") or []
    lines, raw_segments, before_points, after_points = build_boundary_lines(features, tolerance)
    mesh_payload = {
        "type": "FeatureCollection",
        "name": f"municipality_boundaries_{year_key}",
        "features": [{
            "type": "Feature",
            "properties": {
                "layer": "municipality_boundaries",
                "year": int(year_key),
                "source_features": len(features),
                "raw_segments": raw_segments,
                "mesh_lines": len(lines),
            },
            "geometry": {
                "type": "MultiLineString",
                "coordinates": lines,
            },
        }],
    }
    if "crs" in payload:
        mesh_payload["crs"] = payload["crs"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(mesh_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    before_payload = {**payload, "features": features}
    before_bytes = len(json.dumps(before_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return {
        "source_path": str(path.relative_to(bundle_root)).replace("\\", "/"),
        "target_path": str(out_path.relative_to(bundle_root)).replace("\\", "/"),
        "tolerance": tolerance,
        "feature_count": 1,
        "mesh_lines": len(lines),
        "raw_segments": raw_segments,
        "points_before": before_points,
        "points_after": after_points,
        "bytes_before": before_bytes,
        "bytes_after": out_path.stat().st_size,
    }


def simplify_features(features: List[Dict[str, object]], tolerance: float) -> Tuple[List[Dict[str, object]], int, int]:
    before_points = sum(feature_point_count(feature) for feature in features)
    simplified_features = []
    for feature in features:
        out_feature = dict(feature)
        out_feature["geometry"] = simplify_geometry(feature.get("geometry") or {}, tolerance)
        simplified_features.append(out_feature)
    after_points = sum(feature_point_count(feature) for feature in simplified_features)
    return simplified_features, before_points, after_points


def write_simplified_feature_collection(
    payload: Dict[str, object],
    features: List[Dict[str, object]],
    source_path: Path,
    out_path: Path,
    bundle_root: Path,
    tolerance: float,
) -> Dict[str, object]:
    simplified_features, before_points, after_points = simplify_features(features, tolerance)
    simplified_payload = {
        **payload,
        "features": simplified_features,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(simplified_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    before_payload = {**payload, "features": features}
    before_bytes = len(json.dumps(before_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return {
        "source_path": str(source_path.relative_to(bundle_root)).replace("\\", "/"),
        "target_path": str(out_path.relative_to(bundle_root)).replace("\\", "/"),
        "tolerance": tolerance,
        "feature_count": len(features),
        "points_before": before_points,
        "points_after": after_points,
        "bytes_before": before_bytes,
        "bytes_after": out_path.stat().st_size,
    }


def simplify_feature_collection(path: Path, out_path: Path, bundle_root: Path, tolerance: float) -> Dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features") or []
    return write_simplified_feature_collection(payload, features, path, out_path, bundle_root, tolerance)


def province_name_for_feature(feature: Dict[str, object]) -> str:
    props = feature.get("properties") or {}
    return str(
        props.get("province")
        or props.get("province_name")
        or props.get("province_current")
        or props.get("provincia")
        or props.get("province_code")
        or "unknown"
    ).strip() or "unknown"


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "unknown"))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_value).strip("_").lower()
    return slug or "unknown"


def write_detail_chunks_by_province(
    path: Path,
    out_dir: Path,
    bundle_root: Path,
    year_key: str,
    tolerance: float,
) -> Tuple[Dict[str, str], List[Dict[str, object]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features") or []
    by_province: DefaultDict[str, List[Dict[str, object]]] = defaultdict(list)
    for feature in features:
        by_province[province_name_for_feature(feature)].append(feature)

    chunks: Dict[str, str] = {}
    rows: List[Dict[str, object]] = []
    for province in sorted(by_province):
        chunk_rel = Path("data/derived/geometries_detail_by_province") / year_key / f"municipalities_{year_key}_{slugify(province)}.geojson"
        chunk_path = bundle_root / chunk_rel
        rows.append({
            "layer": "municipalities_detail",
            "year": int(year_key),
            "province": province,
            **write_simplified_feature_collection(payload, by_province[province], path, chunk_path, bundle_root, tolerance),
        })
        chunks[province] = str(chunk_rel).replace("\\", "/")
    return chunks, rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a web-optimized geometry pack from the full Italy boundary files.")
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--municipality-tolerance", type=float, default=1100.0, help="Simplification tolerance for municipality boundaries")
    parser.add_argument("--province-tolerance", type=float, default=2000.0, help="Simplification tolerance for province boundaries")
    parser.add_argument("--detail-municipality-tolerance", type=float, default=12.0, help="Simplification tolerance for province chunk detail geometry")
    parser.add_argument("--boundary-tolerance", type=float, default=35.0, help="Simplification tolerance for national municipality boundary mesh")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    derived = root / "data" / "derived"
    full_pack_path = derived / "geometry_pack.json"
    if not full_pack_path.exists():
        raise SystemExit(f"Geometry pack non trovato: {full_pack_path}")
    full_pack = json.loads(full_pack_path.read_text(encoding="utf-8"))
    (derived / "geometry_pack_full.json").write_text(json.dumps(full_pack, ensure_ascii=False, indent=2), encoding="utf-8")

    web_geom_dir = derived / "geometries_web"
    report_rows = []
    web_pack = {
        "availableYears": list(full_pack.get("availableYears") or []),
        "municipalities": {},
        "municipalityBoundaries": {},
        "provinces": {},
        "detailMunicipalities": {},
    }

    for year in full_pack.get("availableYears") or []:
        year_key = str(year)
        muni_rel = str((full_pack.get("municipalities") or {}).get(year_key) or "")
        prov_rel = str((full_pack.get("provinces") or {}).get(year_key) or "")
        if muni_rel:
            in_path = root / muni_rel
            out_rel = Path("data/derived/geometries_web") / f"municipalities_{year_key}.geojson"
            out_path = root / out_rel
            report_rows.append({
                "layer": "municipalities",
                "year": int(year_key),
                **simplify_feature_collection(in_path, out_path, root, args.municipality_tolerance),
            })
            web_pack["municipalities"][year_key] = str(out_rel).replace("\\", "/")
            boundary_rel = Path("data/derived/geometries_web") / f"municipality_boundaries_{year_key}.geojson"
            boundary_path = root / boundary_rel
            report_rows.append({
                "layer": "municipality_boundaries",
                "year": int(year_key),
                **write_boundary_mesh(in_path, boundary_path, root, year_key, args.boundary_tolerance),
            })
            web_pack["municipalityBoundaries"][year_key] = str(boundary_rel).replace("\\", "/")
            chunks, chunk_rows = write_detail_chunks_by_province(
                in_path,
                derived / "geometries_detail_by_province" / year_key,
                root,
                year_key,
                args.detail_municipality_tolerance,
            )
            if chunks:
                web_pack["detailMunicipalities"][year_key] = chunks
                report_rows.extend(chunk_rows)
        if prov_rel:
            in_path = root / prov_rel
            out_rel = Path("data/derived/geometries_web") / f"provinces_{year_key}.geojson"
            out_path = root / out_rel
            report_rows.append({
                "layer": "provinces",
                "year": int(year_key),
                **simplify_feature_collection(in_path, out_path, root, args.province_tolerance),
            })
            web_pack["provinces"][year_key] = str(out_rel).replace("\\", "/")

    (derived / "geometry_pack_web.json").write_text(json.dumps(web_pack, ensure_ascii=False, indent=2), encoding="utf-8")
    totals = {
        "bytes_before": sum(row["bytes_before"] for row in report_rows),
        "bytes_after": sum(row["bytes_after"] for row in report_rows),
        "points_before": sum(row["points_before"] for row in report_rows),
        "points_after": sum(row["points_after"] for row in report_rows),
    }
    if totals["bytes_before"]:
        totals["byte_reduction_pct"] = round(100 * (1 - (totals["bytes_after"] / totals["bytes_before"])), 2)
    if totals["points_before"]:
        totals["point_reduction_pct"] = round(100 * (1 - (totals["points_after"] / totals["points_before"])), 2)
    report = {
        "generated_by": "build_web_geometry_pack.py",
        "municipality_tolerance": args.municipality_tolerance,
        "province_tolerance": args.province_tolerance,
        "detail_municipality_tolerance": args.detail_municipality_tolerance,
        "boundary_tolerance": args.boundary_tolerance,
        "rows": report_rows,
        "totals": totals,
    }
    (derived / "web_geometry_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
