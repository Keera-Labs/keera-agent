from fastapi_startkit.masoniteorm import Model


class AgentQuestion(Model):
    __table__ = "agent_questions"

    id: int
    agent_id: int
    options: list
    multi_select: bool
