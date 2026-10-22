from fastapi_startkit.masoniteorm import Model


class Handoff(Model):
    __table__ = "handoffs"

    id: int
    handoff_key: str
    direction: str
    agent_id: int
    server_id: int | None
    remote_agent_id: int | None
    status: str
