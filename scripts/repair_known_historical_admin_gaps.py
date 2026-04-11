#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import tempfile
from pathlib import Path


PROVINCE_GROUPS = {
    "Trento": {
        "bersone", "bleggio-inferiore", "bolbeno", "bosentino", "breguzzo", "cagno",
        "castelfondo", "centa-san-nicolo", "cimego", "cloz", "condino", "coredo",
        "cunevo", "daiano", "daone", "dare", "don", "dorsino", "faver", "fiera-di-primiero",
        "flavon", "fondo", "grauno", "grumes", "ivano-fracena", "lardaro", "lisignago",
        "lomaso", "monclassico", "nanno", "pozza-di-fassa", "praso", "preore", "prezzo",
        "ragoli", "roncone", "siror", "smarano", "soraga", "spera", "strigno", "taio",
        "tassullo", "terres", "transacqua", "tres", "tuenno", "valda", "varena",
        "vattaro", "vervo", "vigo-di-fassa", "vigo-rendena", "villa-agnedo",
        "villa-rendena", "zambana", "zuclo",
    },
    "Imperia": {"carpasio"},
    "Udine": {
        "buia", "campolongo-al-torre", "ligosullo", "tapogliano", "treppo-carnico",
        "villa-vicentina",
    },
    "Pavia": {"canevino", "ruino"},
    "Lodi": {"camairago", "cavacurta"},
    "Como": {
        "castiglione-d-intelvi", "civenna", "consiglio-di-rumo", "germasino", "lanzo-d-intelvi",
        "lenno", "mezzegra", "ossuccio", "pellio-intelvi", "ramponio-verna",
        "san-fedele-intelvi", "sant-abbondio", "santa-maria-rezzonico", "tremezzo",
    },
    "Mantova": {
        "borgofranco-sul-po", "carbonara-di-po", "felonica", "pieve-di-coriano", "villa-poma",
    },
    "Sondrio": {"menarola"},
    "Lecco": {"introzzo", "tremenico", "vendrogno", "vestreno"},
    "Cremona": {"ca-d-andrea", "drizzona"},
    "Cuneo": {"castellinaldo"},
    "Torino": {"lugnacco", "meugliano", "pecco", "trausella", "vico-canavese"},
    "Vercelli": {
        "breia", "rima-san-giuseppe", "rimasco", "riva-valdobbia", "sabbia", "xxxxx",
    },
    "Biella": {
        "cerreto-castello", "crosa", "mosso", "mosso-santa-maria", "pistolesa",
        "quittengo", "selve-marcone", "soprana", "trivero", "valle-mosso",
    },
    "Verbano-Cusio-Ossola": {"cavaglio-spoccia", "cursolo-orasso", "falmenta"},
    "Alessandria": {"cuccaro-monferrato", "lu"},
    "Ancona": {"castel-colonna", "monterado"},
    "Pesaro e Urbino": {"auditore", "monteciccardo"},
    "Vicenza": {
        "campolongo-sul-brenta", "conco", "lusiana", "mason-vicentino", "molvena",
        "san-nazario", "valstagna",
    },
    "Padova": {"megliadino-san-fidenzio", "santa-margherita-d-adige"},
    "Belluno": {
        "castellavazzo", "castello-lavazzo", "farra-d-alpago", "forno-di-zoldo",
        "lentiai", "mel", "pieve-d-alpago", "puos-d-alpago", "trichiana", "vas",
        "zoldo-alto",
    },
    "Rovigo": {"donada"},
    "Ferrara": {
        "berra", "formignana", "migliarino", "migliaro", "ro", "ro-ferrarese", "tresigallo",
    },
    "Bologna": {
        "bazzano", "castello-di-serravalle", "crespellano", "monteveglio", "porretta-terme",
    },
    "Parma": {"polesine-parmense", "trecasali", "zibello"},
    "Pistoia": {"cutigliano", "piteglio"},
    "Siena": {"san-giovanni-d-asso"},
    "Firenze": {"barberino-val-d-elsa", "tavarnelle-val-di-pesa"},
    "Cagliari": {"cagliari-centro"},
    "Salerno": {"salerno-centro"},
    "Cosenza": {"rossano"},
}

PROVINCE_BY_MUNICIPALITY_ID = {
    municipality_id: province
    for province, municipality_ids in PROVINCE_GROUPS.items()
    for municipality_id in municipality_ids
}

REGION_BY_PROVINCE = {
    "Alessandria": "Piemonte",
    "Ancona": "Marche",
    "Belluno": "Veneto",
    "Biella": "Piemonte",
    "Bologna": "Emilia-Romagna",
    "Cagliari": "Sardegna",
    "Como": "Lombardia",
    "Cosenza": "Calabria",
    "Cremona": "Lombardia",
    "Cuneo": "Piemonte",
    "Ferrara": "Emilia-Romagna",
    "Firenze": "Toscana",
    "Forli'": "Emilia-Romagna",
    "Imperia": "Liguria",
    "Lecco": "Lombardia",
    "Lodi": "Lombardia",
    "Mantova": "Lombardia",
    "Padova": "Veneto",
    "Parma": "Emilia-Romagna",
    "Pavia": "Lombardia",
    "Pesaro": "Marche",
    "Pesaro e Urbino": "Marche",
    "Pistoia": "Toscana",
    "Reggio Emilia": "Emilia-Romagna",
    "Rovigo": "Veneto",
    "Salerno": "Campania",
    "Siena": "Toscana",
    "Sondrio": "Lombardia",
    "Torino": "Piemonte",
    "Trento": "Trentino-Alto Adige",
    "Udine": "Friuli-Venezia Giulia",
    "Verbano-Cusio-Ossola": "Piemonte",
    "Vercelli": "Piemonte",
    "Vicenza": "Veneto",
}


def add_note(note: str, token: str) -> str:
    parts = [part for part in str(note or "").split("|") if part]
    if token not in parts:
        parts.append(token)
    return "|".join(parts)


def repair_csv(path: Path, province_col: str, region_col: str) -> dict[str, int]:
    stats = {"province": 0, "region": 0}
    with path.open("r", encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        fieldnames = list(reader.fieldnames or [])
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", delete=False, dir=path.parent) as tmp:
            writer = csv.DictWriter(tmp, fieldnames=fieldnames)
            writer.writeheader()
            tmp_path = Path(tmp.name)
            for row in reader:
                municipality_id = (row.get("municipality_id") or "").strip()
                province = (row.get(province_col) or "").strip()
                region = (row.get(region_col) or "").strip()
                inferred_province = PROVINCE_BY_MUNICIPALITY_ID.get(municipality_id)
                if not province and inferred_province:
                    row[province_col] = inferred_province
                    province = inferred_province
                    stats["province"] += 1
                    if "comparability_note" in row:
                        row["comparability_note"] = add_note(row.get("comparability_note"), "province_inferred_from_historical_admin_alias")
                inferred_region = REGION_BY_PROVINCE.get(province)
                if not region and inferred_region:
                    row[region_col] = inferred_region
                    stats["region"] += 1
                    if "comparability_note" in row:
                        row["comparability_note"] = add_note(row.get("comparability_note"), "region_inferred_from_historical_province")
                writer.writerow(row)
    tmp_path.replace(path)
    return stats


def update_quality_report(root: Path) -> None:
    summary = root / "data/derived/municipality_summary.csv"
    blank_province = 0
    with summary.open("r", encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            if not (row.get("province") or "").strip():
                blank_province += 1

    quality_path = root / "data/derived/data_quality_report.json"
    if not quality_path.exists():
        return
    quality = json.loads(quality_path.read_text(encoding="utf-8"))
    validations = quality.setdefault("derived_validations", {})
    issues = [
        issue for issue in validations.get("issues", [])
        if issue.get("check") != "missing_province"
    ]
    if blank_province:
        issues.append({
            "severity": "warning",
            "check": "missing_province",
            "scope": "municipality_summary",
            "details": "Provincia vuota su righe comunali osservate.",
            "affected_rows": blank_province,
        })
    validations["issues"] = issues
    validations["issue_count"] = len(issues)
    validations["has_errors"] = any(issue.get("severity") == "error" for issue in issues)
    validations["technical_readiness_score"] = 100 if not issues else 90
    validations["readiness_score"] = validations["technical_readiness_score"]
    quality_path.write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    targets = [
        (root / "data/derived/municipality_summary.csv", "province", "region"),
        (root / "data/derived/municipality_results_long.csv", "province", "region"),
        (root / "data/derived/municipalities_master.csv", "province_current", "region"),
    ]
    totals = {}
    for path, province_col, region_col in targets:
        if path.exists():
            totals[str(path.relative_to(root))] = repair_csv(path, province_col, region_col)
    update_quality_report(root)
    print(json.dumps({"repaired": totals}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
