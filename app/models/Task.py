from fastapi_startkit.masoniteorm import Model

from app.constant.complexity import TaskComplexity

TERMINAL_STATUSES = {"completed", "cancelled"}


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
    completed_at: str | None
    created_at: str | None
    updated_at: str | None
