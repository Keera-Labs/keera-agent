"""AgentTemplate model."""

from fastapi_startkit.masoniteorm import Model


class AgentTemplate(Model):
    __table__ = "agent_templates"
    __timestamps__ = False

    flags: dict
    permissions_allow: list
    permissions_deny: list
