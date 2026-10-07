from typing import Any, NamedTuple, Optional

from pydantic import BaseModel, ConfigDict

ATTENTION_PROMPT_LENGTH = 500

# Notification types that mean Claude is blocked on the user, mapped to the attention_kind
# they imply. `idle_prompt` is not one: after Stop the agent is already `waiting`.
_NOTIFICATION_ATTENTION_KIND = {
    "permission_prompt": "permission",
    "elicitation_dialog": "question",
}


class Attention(NamedTuple):
    kind: str
    prompt: Optional[str]


class AgentHookEventRequest(BaseModel):
    """A Claude Code hook payload (PreToolUse, PostToolUse, Notification, UserPromptSubmit)."""

    model_config = ConfigDict(extra="allow")

    hook_event_name: str = ""
    cwd: str = ""
    tool_name: Optional[str] = None
    tool_input: dict[str, Any] = {}
    message: Optional[str] = None
    notification_type: Optional[str] = None

    def attention(self) -> Attention | None:
        """What the agent is now waiting on the user for, if this event blocks it."""
        if self.hook_event_name == "PreToolUse" and self.tool_name == "AskUserQuestion":
            return Attention("question", truncate_prompt(self._question_text()))
        if self.hook_event_name == "Notification":
            kind = _NOTIFICATION_ATTENTION_KIND.get(self.notification_type)
            if kind:
                return Attention(kind, truncate_prompt(self.message))
        return None

    def resumes_work(self) -> bool:
        return self.hook_event_name in ("PostToolUse", "UserPromptSubmit")

    def _question_text(self) -> Any:
        questions = self.tool_input.get("questions")
        if isinstance(questions, list) and questions and isinstance(questions[0], dict):
            return questions[0].get("question")
        return self.tool_input.get("question")


def truncate_prompt(text: Any) -> Optional[str]:
    if not isinstance(text, str) or not text.strip():
        return None
    text = " ".join(text.split())
    if len(text) <= ATTENTION_PROMPT_LENGTH:
        return text
    return text[: ATTENTION_PROMPT_LENGTH - 1] + "…"
