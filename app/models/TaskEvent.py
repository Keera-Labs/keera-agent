from fastapi_startkit.masoniteorm import Model


class TaskEvent(Model):
    __table__ = "task_events"
    __timestamps__ = False

    id: int
    task_id: int
    fields_changed: dict
