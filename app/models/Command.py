from fastapi_startkit.masoniteorm import Model


class Command(Model):
    __table__ = "commands"
    __timestamps__ = False

    id: int
    project_id: int
    label: str
    command: str
    description: str | None
    category: str | None
    shortcut: str | None
    kind: str
