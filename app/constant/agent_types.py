import enum


class AgentType(str, enum.Enum):
    PM = "pm"
    SOFTWARE_ENGINEER = "software_engineer"
    SOFTWARE_ENGINEER_FRONTEND = "software_engineer_frontend"
    REVIEWER = "reviewer"
    QA = "qa"

    @property
    def role(self) -> str:
        return {
            AgentType.PM: "for coordinating a large workstream across other agents",
            AgentType.SOFTWARE_ENGINEER: "for coding, bug fixes, implementation",
            AgentType.SOFTWARE_ENGINEER_FRONTEND: "for frontend-only implementation",
            AgentType.REVIEWER: "for PR review and approval",
            AgentType.QA: "for testing, code review, browser QA",
        }[self]

    @classmethod
    def pattern(cls) -> str:
        return "^(" + "|".join(t.value for t in cls) + ")$"


DEFAULT_AGENT_TYPE = AgentType.SOFTWARE_ENGINEER

ALLOWED_AGENT_TYPES = {t.value for t in AgentType}
