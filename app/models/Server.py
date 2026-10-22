from fastapi_startkit.masoniteorm import Model


class Server(Model):
    __table__ = "servers"

    id: int
    name: str
    kind: str
    base_url: str
    token: str
