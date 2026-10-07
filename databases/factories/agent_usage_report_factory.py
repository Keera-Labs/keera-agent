import time

from fastapi_startkit.masoniteorm import Factory

from app.models.AgentUsageReport import AgentUsageReport


class AgentUsageReportFactory(Factory):
    model = AgentUsageReport

    def definition(self) -> dict:
        now = int(time.time())
        return {
            "session_id": self.fake.uuid4(),
            "model": "claude-opus-5",
            "five_hour_used_percentage": 23.5,
            "five_hour_resets_at": now + 3600,
            "seven_day_used_percentage": 41.2,
            "seven_day_resets_at": now + 3 * 86400,
            "context_used_percentage": 8.0,
            "context_window_size": 200000,
        }
