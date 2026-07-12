import enum


class TaskComplexity(str, enum.Enum):
    """Task complexity levels used to pick the AI model for an assignment."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


DEFAULT_MODEL = "claude-opus-4-8"

COMPLEXITY_MODEL_MAP = {
    TaskComplexity.EASY: "claude-sonnet-5",
    TaskComplexity.MEDIUM: "claude-sonnet-5",
    TaskComplexity.HARD: "claude-opus-4-8",
}


def model_for_complexity(complexity) -> str:
    """Return the AI model mapped to a task's complexity.

    Missing or unrecognised complexity falls back to the default model so
    callers always receive a usable model id.
    """
    try:
        return COMPLEXITY_MODEL_MAP[TaskComplexity(complexity)]
    except (ValueError, KeyError):
        return DEFAULT_MODEL
