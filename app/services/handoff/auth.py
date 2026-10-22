import hmac

from fastapi_startkit import Config

from app.services.handoff.errors import HandoffDisabled, HandoffUnauthorized


def verify_handoff_token(authorization: str | None) -> None:
    expected = Config.get("fastapi.handoff_token") or ""
    if not expected:
        raise HandoffDisabled("Handoffs are disabled on this server: set KEERA_HANDOFF_TOKEN.")
    scheme, _, presented = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(presented.strip(), expected):
        raise HandoffUnauthorized("Invalid handoff token.")
