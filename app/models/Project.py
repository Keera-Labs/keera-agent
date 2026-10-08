import datetime

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
    is_repository: bool
    # NULL hides the project from the sidebar; otherwise it orders the sidebar, newest first.
    last_opened_at: str | None
    created_at: str | None
    updated_at: str | None

    @classmethod
    def in_sidebar(cls):
        """Visible projects, most recently opened first."""
        # where_raw, not where_not_null: the latter adds a stray None binding that
        # shifts every later placeholder (e.g. a workspace_id filter) by one.
        return cls.where_raw('"projects"."last_opened_at" IS NOT NULL').order_by_raw(
            "last_opened_at DESC, id DESC"
        )

    @staticmethod
    def now() -> str:
        """UTC in the ORM's own timestamp format, so ORDER BY string comparisons stay consistent."""
        return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
