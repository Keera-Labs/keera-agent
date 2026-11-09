from fastapi_startkit.masoniteorm import Model


class TaskDependency(Model):
    __table__ = "task_dependencies"

    id: int
    task_id: int
    depends_on_task_id: int
    hard: bool
