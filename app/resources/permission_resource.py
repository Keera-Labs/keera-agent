import json

from fastapi.responses import JSONResponse


def _as_list(value) -> list:
    """Coerce an allow/deny value to a list.

    Agent permission columns come back as a JSON string once loaded from the
    database but as a list while still in memory; the stored defaults are already
    lists. Normalise all of them to a list.
    """
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


class PermissionResource(JSONResponse):
    """Serialize an {allow, deny} permission payload plus optional extra keys
    (e.g. applied_to_projects). Not model-backed, so it stays a plain response."""

    def __init__(self, allow, deny, **extra):
        super().__init__({"allow": _as_list(allow), "deny": _as_list(deny), **extra})
