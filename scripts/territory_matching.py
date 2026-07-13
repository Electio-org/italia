from typing import Dict, Iterable, Optional, Tuple


def is_token_prefix(left: str, right: str) -> bool:
    if left == right:
        return True
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    return longer.startswith(shorter) and longer[len(shorter):len(shorter) + 1] in {" ", "-", "'"}


def resolve_contextual_prefix(
    candidate_keys: Iterable[str],
    context_key: str,
    records_by_name_context: Dict[Tuple[str, str], Dict[str, str]],
) -> Optional[Dict[str, str]]:
    """Resolve a prefix match only inside one province or region."""
    if not context_key:
        return None
    candidates = []
    for candidate_key in candidate_keys:
        for (reference_name, reference_context), record in records_by_name_context.items():
            if reference_context != context_key:
                continue
            if is_token_prefix(reference_name, candidate_key):
                candidates.append(record)
                if len(candidates) > 3:
                    break
    unique_ids = {
        (str(row.get("municipality_id") or ""), str(row.get("geometry_id") or ""))
        for row in candidates
    }
    return candidates[0] if len(unique_ids) == 1 and candidates else None
