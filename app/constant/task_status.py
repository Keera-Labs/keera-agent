import enum


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

    @classmethod
    def pattern(cls) -> str:
        """Regex matching any status, for MCP tool input schemas."""
        return "^(" + "|".join(s.value for s in cls) + ")$"
