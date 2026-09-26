from fastapi_startkit.jsonapi import JsonResource

from app.models.AgentUsageReport import AgentUsageReport
from app.resources.agent_usage_report_resource import AgentUsageReportResource
from app.services.claude_usage import ProjectUsage


class ProjectUsageResource(JsonResource[ProjectUsage]):
    """A project's Claude usage: token totals from transcripts plus statusline reports."""

    def __init__(self, model: ProjectUsage, reports: list[AgentUsageReport] | None = None):
        super().__init__(model)
        self.reports = reports or []

    def to_attributes(self) -> dict:
        usage = self.model
        reports = [AgentUsageReportResource(report).to_attributes() for report in self.reports]
        return {
            "today": usage.today.to_dict(),
            "agents": {str(agent_id): agent.to_dict() for agent_id, agent in usage.agents.items()},
            "reports": {str(report["agent_id"]): report for report in reports},
            "limits": _latest_limits(reports),
        }


def _latest_limits(reports: list[dict]) -> dict | None:
    # Plan limits are account-wide, so the most recent report speaks for every agent.
    # `reports` arrive newest first.
    for report in reports:
        if report["five_hour"] or report["seven_day"]:
            return {"five_hour": report["five_hour"], "seven_day": report["seven_day"]}
    return None
