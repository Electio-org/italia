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

print("territorial prefix resolution smoke: ok")
