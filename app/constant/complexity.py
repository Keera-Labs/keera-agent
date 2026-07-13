import enum

DEFAULT_MODEL = "claude-opus-4-8"


class TaskComplexity(str, enum.Enum):
    """Task complexity levels used to pick the AI model for an assignment."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"

    def model(self) -> str:
        match self:
            case TaskComplexity.EASY | TaskComplexity.MEDIUM:
                return "claude-sonnet-5"
            case TaskComplexity.HARD:
                return "claude-opus-4-8"

    @classmethod
    def model_for(cls, value) -> str:
        """Model mapped to a complexity value.

        Missing or unrecognised values fall back to the default model so callers
        always receive a usable model id.
        """
        try:
            return cls(value).model()
        except ValueError:
            return DEFAULT_MODEL
