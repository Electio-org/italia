#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from typing import Dict, Iterable, List


def normalize_lookup_key(value: str) -> str:
    text = str(value or "").strip()
    text = text.replace("&", " e ").replace("'", " ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def smart_title(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if any(ch.islower() for ch in text):
        return re.sub(r"\s+", " ", text).strip()
    titled = text.lower().title()
    for old, new in {
        " Di ": " di ",
        " Del ": " del ",
        " Della ": " della ",
        " Delle ": " delle ",
        " Dei ": " dei ",
        " Degli ": " degli ",
        " E ": " e ",
        " In ": " in ",
        " Sul ": " sul ",
        " Sulla ": " sulla ",
        " Al ": " al ",
        " Alla ": " alla ",
        " Da ": " da ",
        " De ": " de ",
        " D'": " d'",
        " L'": " l'",
    }.items():
        titled = titled.replace(old, new)
    return re.sub(r"\s+", " ", titled).strip()


def shape_geometry(shape) -> Dict[str, object]:
    # pyshp exposes GeoJSON-like coordinates through __geo_interface__.
    return shape.__geo_interface__


def read_records(shp_path: Path) -> Iterable[tuple[Dict[str, object], Dict[str, object]]]:
    try:
        import shapefile  # type: ignore
    except ImportError as exc:
        raise SystemExit("Dipendenza mancante: installa pyshp con `python -m pip install pyshp`.") from exc
    reader = shapefile.Reader(str(shp_path), encoding="utf-8")
    for shape_record in reader.iterShapeRecords():
        yield shape_record.record.as_dict(), shape_geometry(shape_record.shape)


def find_first(root: Path, pattern: str) -> Path:
    matches = list(root.rglob(pattern))
    if not matches:
        raise SystemExit(f"File non trovato nel pacchetto ISTAT: {pattern}")
    return matches[0]


def extract_zip(zip_path: Path) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="istat_limiti_", dir=str(zip_path.parent)))
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(tmp)
    return tmp


def write_geojson(path: Path, features: List[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "name": path.stem,
        "crs": {
            "type": "name",
            "properties": {"name": "EPSG:32632"},
        },
        "features": features,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build all-Italy 2021 municipality/province/region GeoJSON from ISTAT Limiti2021.zip.")
    parser.add_argument("--zip", default=r"C:\Users\sim11\Downloads\Limiti2021.zip", help="Path to ISTAT Limiti2021.zip")
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--year", type=int, default=2021, help="Boundary year")
    parser.add_argument("--keep-extracted", action="store_true", help="Keep extracted ISTAT files for debugging")
    args = parser.parse_args()

    zip_path = Path(args.zip).resolve()
    root = Path(args.root).resolve()
    if not zip_path.exists():
        raise SystemExit(f"Pacchetto ISTAT non trovato: {zip_path}")

    extracted = extract_zip(zip_path)
    try:
        com_shp = find_first(extracted, "Com2021.shp")
        prov_shp = find_first(extracted, "ProvCM2021.shp")
        reg_shp = find_first(extracted, "Reg2021.shp")

        province_by_uts: Dict[int, Dict[str, object]] = {}
        province_features: List[Dict[str, object]] = []
        for record, geometry in read_records(prov_shp):
            code = int(record.get("COD_UTS") or record.get("COD_PROV") or 0)
            province = smart_title(str(record.get("DEN_UTS") or record.get("DEN_PROV") or record.get("DEN_CM") or ""))
            region_code = int(record.get("COD_REG") or 0)
            province_record = {
                "geometry_id": f"{code:03d}",
                "province_code": code,
                "province": province,
                "region_code": region_code,
                "sigla": str(record.get("SIGLA") or "").strip(),
                "type": smart_title(str(record.get("TIPO_UTS") or "")),
                "year": args.year,
            }
            province_by_uts[code] = province_record
            province_features.append({"type": "Feature", "properties": province_record, "geometry": geometry})

        region_by_code: Dict[int, str] = {}
        region_features: List[Dict[str, object]] = []
        for record, geometry in read_records(reg_shp):
            code = int(record.get("COD_REG") or 0)
            region = smart_title(str(record.get("DEN_REG") or ""))
            region_by_code[code] = region
            region_features.append({
                "type": "Feature",
                "properties": {
                    "geometry_id": f"{code:02d}",
                    "region_code": code,
                    "region": region,
                    "year": args.year,
                },
                "geometry": geometry,
            })

        municipality_features: List[Dict[str, object]] = []
        lookup_rows: List[Dict[str, object]] = []
        for record, geometry in read_records(com_shp):
            geometry_id = str(record.get("PRO_COM_T") or "").strip() or f"{int(record.get('PRO_COM') or 0):06d}"
            province_code = int(record.get("COD_UTS") or 0)
            region_code = int(record.get("COD_REG") or 0)
            province = province_by_uts.get(province_code, {}).get("province") or ""
            region = region_by_code.get(region_code, "")
            name = smart_title(str(record.get("COMUNE") or ""))
            props = {
                "geometry_id": geometry_id,
                "municipality_id": geometry_id,
                "name_current": name,
                "name": name,
                "province_code": province_code,
                "province": province,
                "region_code": region_code,
                "region": region,
                "year": args.year,
            }
            municipality_features.append({"type": "Feature", "properties": props, "geometry": geometry})
            lookup_rows.append({
                "normalized_name": normalize_lookup_key(name),
                "normalized_province": normalize_lookup_key(str(province)),
                "normalized_region": normalize_lookup_key(str(region)),
                "geometry_id": geometry_id,
                "province": province,
                "province_code": province_code,
                "region": region,
                "region_code": region_code,
            })

        derived = root / "data" / "derived"
        geom_dir = derived / "geometries"
        write_geojson(geom_dir / f"municipalities_{args.year}.geojson", municipality_features)
        write_geojson(geom_dir / f"provinces_{args.year}.geojson", province_features)
        write_geojson(geom_dir / f"regions_{args.year}.geojson", region_features)

        pack = {
            "scope": "italy",
            "availableYears": [str(args.year)],
            "municipalities": {str(args.year): f"data/derived/geometries/municipalities_{args.year}.geojson"},
            "provinces": {str(args.year): f"data/derived/geometries/provinces_{args.year}.geojson"},
            "regions": {str(args.year): f"data/derived/geometries/regions_{args.year}.geojson"},
        }
        (derived / "geometry_pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2), encoding="utf-8")

        ref_dir = root / "data" / "reference"
        ref_dir.mkdir(parents=True, exist_ok=True)
        lookup_path = ref_dir / "municipality_geometry_lookup.csv"
        import csv
        with lookup_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(lookup_rows[0].keys()))
            writer.writeheader()
            writer.writerows(lookup_rows)

        report = {
            "generated_by": "build_italy_geometry_pack_from_istat.py",
            "source_zip": str(zip_path).replace("\\", "/"),
            "scope": "italy",
            "year": args.year,
            "municipalities": len(municipality_features),
            "provinces": len(province_features),
            "regions": len(region_features),
        }
        (derived / "italy_geometry_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        if args.keep_extracted:
            print(f"ISTAT estratto in: {extracted}")
        else:
            shutil.rmtree(extracted, ignore_errors=True)


if __name__ == "__main__":
    main()
