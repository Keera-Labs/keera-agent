"""AgentTemplate model."""

from fastapi_startkit.masoniteorm import Model


class AgentTemplate(Model):
    __table__ = "agent_templates"
