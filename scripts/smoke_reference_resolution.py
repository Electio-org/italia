import csv
import gzip
import json
from pathlib import Path

from territory_matching import resolve_contextual_prefix


def record(municipality_id: str, geometry_id: str):
    return {"municipality_id": municipality_id, "geometry_id": geometry_id}


references = {
    ("roma", "lazio"): record("058091", "058091"),
    ("romallo", "trentino alto adige"): record("022155", "022155"),
    ("roma centro", "lazio"): record("058091", "058091"),
}

assert resolve_contextual_prefix(["roma centro"], "lazio", references)["municipality_id"] == "058091"
assert resolve_contextual_prefix(["romallo"], "trentino alto adige", references)["municipality_id"] == "022155"
assert resolve_contextual_prefix(["romallo"], "lazio", references) is None
assert resolve_contextual_prefix(["romallo"], "", references) is None


root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "data/derived/manifest.json").read_text(encoding="utf-8"))
summary_index = json.loads((root / manifest["files"]["municipalitySummaryByElectionIndex"]).read_text(encoding="utf-8"))
results_index = json.loads((root / manifest["files"]["municipalityResultsLongByElectionIndex"]).read_text(encoding="utf-8"))
assert summary_index["territorial_mode"] == "harmonized"
assert results_index["territorial_mode"] == "harmonized"
assert summary_index["target_geometry_date"] == "2021-12-31"

with (root / manifest["files"]["municipalitiesMaster"]).open(encoding="utf-8", newline="") as handle:
    municipalities = list(csv.DictReader(handle))
assert len(municipalities) == 7904
val_brembilla = next(row for row in municipalities if row["municipality_id"] == "016253")
assert "Brembilla" in val_brembilla["alias_names"]
assert "gerosa" in val_brembilla["alias_names"].casefold()
roma_master = next(row for row in municipalities if row["municipality_id"] == "058091")
assert "romallo" not in roma_master["alias_names"].casefold()

with gzip.open(root / manifest["files"]["territorialCrosswalk"], "rt", encoding="utf-8", newline="") as handle:
    crosswalk = list(csv.DictReader(handle))
brembilla_2013 = [
    row for row in crosswalk
    if row["election_key"] == "camera_2013" and row["source_name"] in {"Brembilla", "Gerosa"}
]
assert len(brembilla_2013) == 2
assert {row["target_geometry_id"] for row in brembilla_2013} == {"016253"}
roma_1992 = next(
    row for row in crosswalk
    if row["election_key"] == "camera_1992" and row["source_municipality_id"] == "058091"
)
assert roma_1992["target_geometry_id"] == "058091"
assert roma_1992["resolution_method"] == "dated_registry_code_repaired_label"

summary_2013_path = root / summary_index["shards"]["camera_2013"]
summary_opener = gzip.open if summary_2013_path.suffix == ".gz" else summary_2013_path.open
with summary_opener(summary_2013_path, "rt", encoding="utf-8", newline="") if summary_2013_path.suffix == ".gz" else summary_opener(encoding="utf-8", newline="") as handle:
    summary_2013 = list(csv.DictReader(handle))
projected = next(row for row in summary_2013 if row["municipality_id"] == "016253")
assert projected["municipality_name"] == "Val Brembilla"
assert projected["territorial_mode"] == "harmonized"
assert projected["territorial_status"] == "harmonized_complete_predecessors"

summary_1992_path = root / summary_index["shards"]["camera_1992"]
summary_1992_opener = gzip.open if summary_1992_path.suffix == ".gz" else summary_1992_path.open
with summary_1992_opener(summary_1992_path, "rt", encoding="utf-8", newline="") if summary_1992_path.suffix == ".gz" else summary_1992_opener(encoding="utf-8", newline="") as handle:
    summary_1992 = list(csv.DictReader(handle))
roma_projected = next(row for row in summary_1992 if row["municipality_id"] == "058091")
assert roma_projected["municipality_name"] == "Roma"
assert abs(float(roma_projected["valid_votes"]) - 1978381) < 1
assert roma_projected["first_party_std"] == "DC"

results_1992_path = root / results_index["shards"]["camera_1992"]
results_1992_opener = gzip.open if results_1992_path.suffix == ".gz" else results_1992_path.open
with results_1992_opener(results_1992_path, "rt", encoding="utf-8", newline="") if results_1992_path.suffix == ".gz" else results_1992_opener(encoding="utf-8", newline="") as handle:
    roma_results_1992 = [row for row in csv.DictReader(handle) if row["municipality_id"] == "058091"]
assert len(roma_results_1992) >= 20
assert sum(float(row["votes"] or 0) for row in roma_results_1992) == 1978381

report = json.loads((root / manifest["files"]["territorialHistoryReport"]).read_text(encoding="utf-8"))
assert len(report["elections"]) == len(summary_index["shards"])
assert min(float(row["coverage_pct"]) for row in report["elections"]) >= 98

print("territorial prefix and historical lineage smoke: ok")
