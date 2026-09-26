import time

from fastapi_startkit.jsonapi import JsonResource

from app.models.AgentUsageReport import AgentUsageReport


def live_window(used_percentage: float | None, resets_at: int | None) -> dict | None:
    """A rate-limit window, or None once it has reset (Claude Code drops those too)."""
    if used_percentage is None or (resets_at is not None and resets_at <= time.time()):
        return None
    return {"used_percentage": used_percentage, "resets_at": resets_at}


class AgentUsageReportResource(JsonResource[AgentUsageReport]):
    def to_attributes(self) -> dict:
        report = self.model
        return {
            "agent_id": report.agent_id,
            "model": report.model,
            "five_hour": live_window(report.five_hour_used_percentage, report.five_hour_resets_at),
            "seven_day": live_window(report.seven_day_used_percentage, report.seven_day_resets_at),
            "context_used_percentage": report.context_used_percentage,
            "context_window_size": report.context_window_size,
            "updated_at": str(report.updated_at) if report.updated_at else None,
        }
