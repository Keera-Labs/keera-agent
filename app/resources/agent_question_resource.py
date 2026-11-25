import json
import re

from fastapi_startkit.jsonapi import JsonResource

from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.models.Project import Project

_RECOMMENDED_SUFFIX = re.compile(r"\s*\(recommended\)\s*$", re.IGNORECASE)


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


def _option(option: dict) -> dict:
    label = str(option.get("label", ""))
    return {
        "label": _RECOMMENDED_SUFFIX.sub("", label),
        "description": option.get("description"),
        "recommended": bool(_RECOMMENDED_SUFFIX.search(label)),
    }


class AgentQuestionResource(JsonResource[AgentQuestion]):
    def __init__(
        self, model: AgentQuestion, agent: Agent | None = None, project: Project | None = None
    ):
        super().__init__(model)
        self.agent = agent
        self.project = project

    def to_attributes(self) -> dict:
        question = self.model
        return {
            "agent_id": question.agent_id,
            "project_id": question.project_id,
            "session_id": question.session_id,
            "tool_use_id": question.tool_use_id,
            "position": question.position,
            "kind": question.kind or "question",
            "question": question.question,
            "header": question.header,
            "detail": question.detail,
            "options": [_option(option) for option in _as_list(question.options)],
            "multi_select": bool(question.multi_select),
            "status": question.status,
            "answer": question.answer,
            "answered_at": _timestamp(question.answered_at),
            "created_at": _timestamp(question.created_at),
            **self._context(),
        }

    def _context(self) -> dict:
        if not self.agent:
            return {}
        return {
            "agent_name": self.agent.name,
            "agent_type": self.agent.agent_type,
            "agent_model": self.agent.model,
            "task_id": self.agent.task_id,
            "worktree": f"agent-{self.agent.id}"
            if getattr(self.agent, "use_worktree", True)
            else None,
            "project_name": self.project.name if self.project else None,
            "project_slug": self.project.slug if self.project else None,
        }
