from fastapi_startkit.masoniteorm import Model


class AgentUsageReport(Model):
    """The latest plan-limit and context usage an agent's statusline reported."""

    __table__ = "agent_usage_reports"
