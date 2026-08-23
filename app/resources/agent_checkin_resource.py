from fastapi.responses import JSONResponse


class AgentCheckinResource(JSONResponse):
    """Serialize the PM check-in scheduler state. Not model-backed (the running
    flag is in-process state), so it stays a plain JSON response."""

    def __init__(self, enabled: bool, interval_minutes: int, running: bool):
        super().__init__(
            {
                "enabled": bool(enabled),
                "interval_minutes": int(interval_minutes),
                "running": bool(running),
            }
        )
