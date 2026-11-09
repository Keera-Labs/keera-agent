import enum


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    CREATED = "created"
    ASSIGNED = "assigned"
    ACKED = "acked"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"
    MERGED = "merged"
    DONE = "done"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

    @classmethod
    def pattern(cls) -> str:
        return "^(" + "|".join(s.value for s in cls) + ")$"


LEGACY_STATUSES = {"pending": "created", "completed": "done"}

TERMINAL_STATUSES = {"done", "completed", "cancelled"}

ACTIVE_STATUSES = tuple(s.value for s in TaskStatus if s.value not in TERMINAL_STATUSES)

DISPLAY_STATUSES = {
    "created": "pending",
    "assigned": "pending",
    "acked": "pending",
    "blocked": "in_progress",
    "changes_requested": "in_progress",
    "approved": "in_review",
    "merged": "in_review",
    "done": "completed",
}


def canonical_status(status: str | None) -> str:
    return LEGACY_STATUSES.get(status or "created", status or "created")


def display_status(status: str | None) -> str:
    return DISPLAY_STATUSES.get(status or "pending", status or "pending")
