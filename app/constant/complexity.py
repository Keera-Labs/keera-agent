import enum

# The only agent models the app offers for NEW selections/spawns. Every model
# reference (UI dropdown, spawn_agent default, template seeds, complexity
# mapping) must resolve to one of these ids. Existing agents keep whatever model
# they were created with — stored values are never rewritten.
ALLOWED_MODELS = ("claude-opus-5", "claude-sonnet-5", "claude-fable-5")

DEFAULT_MODEL = "claude-opus-5"


class TaskComplexity(str, enum.Enum):
    """Task complexity levels used to pick the AI model for an assignment."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"

    def model(self) -> str:
        match self:
            case TaskComplexity.EASY:
                return "claude-sonnet-5"
            case TaskComplexity.MEDIUM:
                return "claude-opus-5"
            case TaskComplexity.HARD:
                return "claude-fable-5"

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
