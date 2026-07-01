from fastapi_startkit.masoniteorm import Model


class Plugin(Model):
    __table__ = "plugins"

    id: int
    slug: str
    name: str
    description: str | None
    path: str | None
    active: bool
    created_at: str | None
    updated_at: str | None
