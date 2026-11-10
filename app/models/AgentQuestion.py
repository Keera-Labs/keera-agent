from fastapi_startkit.masoniteorm import Model


class AgentQuestion(Model):
    __table__ = "agent_questions"
    __timestamps__ = False

    id: int
    agent_id: int
    options: list
    multi_select: bool
