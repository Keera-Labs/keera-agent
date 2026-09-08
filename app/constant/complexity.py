import enum

from app.ai import providers

# Legacy Claude-only model constants retained for existing selection paths.
ALLOWED_MODELS = ("claude-opus-5", "claude-sonnet-5", "claude-fable-5")

DEFAULT_MODEL = "claude-opus-5"


class TaskComplexity(str, enum.Enum):
    """Task complexity levels used to pick the AI model for an assignment."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"

    def model(self, provider: str = "claude") -> str:
        """Return the provider's built-in model for this complexity tier."""
        models = {
            "claude": {
                TaskComplexity.EASY: "claude-sonnet-5",
                TaskComplexity.MEDIUM: "claude-opus-5",
                TaskComplexity.HARD: "claude-fable-5",
            },
            "codex": {
                TaskComplexity.EASY: "gpt-5.6-luna",
                TaskComplexity.MEDIUM: "gpt-5.6-terra",
                TaskComplexity.HARD: "gpt-5.6-sol",
            },
        }
        providers.get(provider)
        return models[provider][self]

    @classmethod
    def model_for(cls, value, provider: str = "claude") -> str:
        """Model mapped to a complexity value.

        Missing or unrecognised values fall back to the default model so callers
        always receive a usable model id.
        """
        try:
            return cls(value).model(provider)
        except ValueError:
            return DEFAULT_MODEL
