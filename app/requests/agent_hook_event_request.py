import json
from typing import Any, NamedTuple, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from app.requests.agent_question_request import AskedQuestion

ATTENTION_PROMPT_LENGTH = 500
PERMISSION_DETAIL_LENGTH = 4000
USER_QUESTION_TOOL = "AskUserQuestion"
_PERMISSION_DETAIL_KEYS = ("command", "file_path", "notebook_path", "url", "pattern", "query")

# Notification types that mean Claude is blocked on the user, mapped to the attention_kind
# they imply. `idle_prompt` is not one: after Stop the agent is already `waiting`.
_NOTIFICATION_ATTENTION_KIND = {
    "permission_prompt": "permission",
    "ToolPermission": "permission",
    "elicitation_dialog": "question",
}


class Attention(NamedTuple):
    kind: str
    prompt: Optional[str]


class AgentHookEventRequest(BaseModel):
    """A Claude Code hook payload (PreToolUse, PostToolUse, PermissionRequest, Notification, UserPromptSubmit)."""

    model_config = ConfigDict(extra="allow")

    hook_event_name: str = ""
    cwd: str = ""
    tool_name: Optional[str] = None
    session_id: Optional[str] = None
    tool_use_id: Optional[str] = None
    tool_input: dict[str, Any] = {}
    tool_response: Any = None
    message: Optional[str] = None
    notification_type: Optional[str] = None

    def attention(self) -> Attention | None:
        """What the agent is now waiting on the user for, if this event blocks it."""
        if self.asks_user_question():
            return Attention("question", truncate_prompt(self._question_text()))
        if self.requests_permission():
            detail = self.permission_detail() or ""
            return Attention(
                "permission", truncate_prompt(f"{self.permission_question()} {detail}")
            )
        if self.hook_event_name == "Notification" and not self._concerns_user_question():
            kind = _NOTIFICATION_ATTENTION_KIND.get(self.notification_type)
            if kind:
                return Attention(kind, truncate_prompt(self.message))
        return None

    def asks_user_question(self) -> bool:
        return self.hook_event_name == "PreToolUse" and self.tool_name == USER_QUESTION_TOOL

    def asks_permission(self) -> bool:
        return self.requests_permission() or self.notifies_permission()

    def requests_permission(self) -> bool:
        return self.hook_event_name == "PermissionRequest" and not self._concerns_user_question()

    def notifies_permission(self) -> bool:
        return (
            self.hook_event_name == "Notification"
            and _NOTIFICATION_ATTENTION_KIND.get(self.notification_type) == "permission"
            and not self._concerns_user_question()
        )

    def _concerns_user_question(self) -> bool:
        return self.tool_name == USER_QUESTION_TOOL or USER_QUESTION_TOOL in (self.message or "")

    def permission_question(self) -> str:
        if self.requests_permission() and self.tool_name:
            return f"Allow {self.tool_name}?"
        return self.message or "The agent needs your permission to continue"

    def permission_detail(self) -> Optional[str]:
        if not self.requests_permission() or not self.tool_input:
            return None
        for key in _PERMISSION_DETAIL_KEYS:
            value = self.tool_input.get(key)
            if isinstance(value, str) and value.strip():
                return value[:PERMISSION_DETAIL_LENGTH]
        return json.dumps(self.tool_input, indent=2, default=str)[:PERMISSION_DETAIL_LENGTH]

    def answers_user_question(self) -> bool:
        return self.hook_event_name == "PostToolUse" and self.tool_name == USER_QUESTION_TOOL

    def asked_questions(self) -> list[AskedQuestion]:
        questions = self.tool_input.get("questions")
        if not isinstance(questions, list):
            return []
        asked = []
        for question in questions:
            try:
                asked.append(AskedQuestion.model_validate(question))
            except ValidationError:
                continue
        return asked

    def answers(self) -> dict[str, str]:
        response = self.tool_response if isinstance(self.tool_response, dict) else {}
        answers = response.get("answers") or self.tool_input.get("answers")
        if not isinstance(answers, dict):
            return {}
        return {str(question): str(answer) for question, answer in answers.items()}

    def resumes_work(self) -> bool:
        return self.finishes_tool_call() or self.starts_turn()

    def finishes_tool_call(self) -> bool:
        return self.hook_event_name in ("PostToolUse", "AfterTool")

    def starts_turn(self) -> bool:
        return self.hook_event_name in ("UserPromptSubmit", "BeforeAgent")

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
