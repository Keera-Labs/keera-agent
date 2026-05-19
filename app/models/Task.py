from fastapi_startkit.masoniteorm import Model


class Task(Model):
    __table__ = "tasks"
