from fastapi_startkit.masoniteorm import Model


class Project(Model):
    __table__ = "projects"

    id: int
    name: str
    slug: str
    path: str
    language: str
    workspace_id: int | None
    last_session_id: int | None
    claude_status: str | None
    system_prompt: str | None
    permissions_allow: str | None
    permissions_deny: str | None
    created_at: str | None
    updated_at: str | None
