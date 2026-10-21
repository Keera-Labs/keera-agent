import json

from fastapi_startkit.jsonapi import JsonResource

from app.models.AgentQuestion import AgentQuestion


def _as_list(value) -> list:
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return []


def _timestamp(value) -> str | None:
    return str(value) if value else None


class AgentQuestionResource(JsonResource[AgentQuestion]):
    def to_attributes(self) -> dict:
        question = self.model
        return {
            "agent_id": question.agent_id,
            "project_id": question.project_id,
            "session_id": question.session_id,
            "tool_use_id": question.tool_use_id,
            "position": question.position,
            "question": question.question,
            "header": question.header,
            "options": _as_list(question.options),
            "multi_select": bool(question.multi_select),
            "status": question.status,
            "answer": question.answer,
            "answered_at": _timestamp(question.answered_at),
            "created_at": _timestamp(question.created_at),
        }
