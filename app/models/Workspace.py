from fastapi_startkit.masoniteorm import Model


class Workspace(Model):
    __table__ = "workspaces"

    id: int
    name: str
    description: str | None
    claude_config_dir: str | None
