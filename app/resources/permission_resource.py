from fastapi.responses import JSONResponse


class PermissionResource(JSONResponse):
    """Serialize an {allow, deny} permission payload plus optional extra keys
    (e.g. applied_to_projects). Not model-backed, so it stays a plain response."""

    def __init__(self, allow, deny, **extra):
        super().__init__({"allow": allow or [], "deny": deny or [], **extra})
