from app.models.Agent import Agent
from app.models.AgentUsageReport import AgentUsageReport
from app.requests.agent_usage_report_request import AgentUsageReportRequest
from app.resources.agent_usage_report_resource import AgentUsageReportResource


async def store(body: AgentUsageReportRequest) -> AgentUsageReportResource:
    """Keep only the latest report per agent; the statusline posts one on every refresh."""
    await Agent.find_or_fail(body.agent_id)
    data = body.model_dump()
    report = await AgentUsageReport.where("agent_id", body.agent_id).first()
    if report:
        for key, value in data.items():
            setattr(report, key, value)
        await report.save()
    else:
        report = await AgentUsageReport.create(data)
    return AgentUsageReportResource(report)
