import datetime

from fastapi_startkit.masoniteorm import Model

from app.constant.complexity import TaskComplexity
from app.models.casts import NullableInt

TERMINAL_STATUSES = {"completed", "cancelled"}

REVIEW_FIELDS = (
    "pr_number",
    "pr_url",
    "branch",
    "additions",
    "deletions",
    "review_note",
    "progress_step",
    "progress_total",
)


class Task(Model):
    __table__ = "tasks"

    id: int
    project_id: int
    title: str | None
    body: str | None
    assignees: list
    acceptance_criteria: list
    testing_methods: list
    validation_steps: list
    priority: str | None
    complexity: TaskComplexity
    status: str | None
    pr_number: NullableInt
    pr_url: str | None
    branch: str | None
    additions: NullableInt
    deletions: NullableInt
    review_note: str | None
    progress_step: NullableInt
    progress_total: NullableInt
    completed_at: str | None
    created_at: str | None
    updated_at: str | None

    def completed_at_for(self, status: str) -> str | None:
        """completed_at after moving to `status`: stamped on entering a terminal
        status, kept while it stays terminal, cleared when reopened."""
        if status not in TERMINAL_STATUSES:
            return None
        if self.status in TERMINAL_STATUSES and self.completed_at:
            return self.completed_at
        return datetime.datetime.now().isoformat()
