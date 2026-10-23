from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.requests.agent_hook_event_request import AgentHookEventRequest

PERMISSION_OPTIONS = [
    {"label": "Allow", "description": "Let the agent go ahead with this step"},
    {"label": "Deny", "description": "Block it and tell the agent why below"},
]


async def record_agent_questions(agent: Agent, event: AgentHookEventRequest) -> None:
    if event.asks_user_question():
        await _store_asked(agent, event)
    elif event.answers_user_question():
        await _store_answers(agent, event)
    elif event.asks_permission():
        await _store_permission(agent, event)
    if event.starts_turn():
        await settle_pending_questions(agent.id)
    elif event.finishes_tool_call():
        await _settle_pending_permissions(agent)


async def _store_asked(agent: Agent, event: AgentHookEventRequest) -> None:
    if event.tool_use_id and await _questions_for(agent, event.tool_use_id).first():
        return
    for position, asked in enumerate(event.asked_questions()):
        await AgentQuestion.create(
            {
                "agent_id": agent.id,
                "project_id": agent.project_id,
                "session_id": event.session_id,
                "tool_use_id": event.tool_use_id,
                "position": position,
                "kind": "question",
                "question": asked.question,
                "header": asked.header,
                "options": [option.model_dump() for option in asked.options],
                "multi_select": asked.multi_select,
                "status": "pending",
            }
        )


async def _store_answers(agent: Agent, event: AgentHookEventRequest) -> None:
    if not event.tool_use_id:
        return
    answers = event.answers()
    pending = await _questions_for(agent, event.tool_use_id).where("status", "pending").get()
    for question in pending:
        await _mark_answered(question.id, answers.get(question.question))


async def _store_permission(agent: Agent, event: AgentHookEventRequest) -> None:
    if event.notifies_permission() and await _pending(agent).where("kind", "question").first():
        return
    pending = await _pending(agent).where("kind", "permission").first()
    if pending and event.notifies_permission() and pending.detail:
        return
    prompt = {
        "session_id": event.session_id,
        "question": event.permission_question(),
        "header": event.tool_name if event.requests_permission() else None,
        "detail": event.permission_detail(),
    }
    if pending:
        await AgentQuestion.where("id", pending.id).update(
            {**prompt, "created_at": utc_now(), "updated_at": utc_now()}
        )
        return
    await AgentQuestion.create(
        {
            **prompt,
            "agent_id": agent.id,
            "project_id": agent.project_id,
            "kind": "permission",
            "options": PERMISSION_OPTIONS,
            "multi_select": False,
            "status": "pending",
        }
    )


async def settle_pending_questions(agent_id: int) -> None:
    for question in (
        await AgentQuestion.where("agent_id", agent_id).where("status", "pending").get()
    ):
        await _mark_answered(question.id, None)


async def has_pending_question(agent_id: int) -> bool:
    pending = AgentQuestion.where("agent_id", agent_id).where("status", "pending")
    return await pending.where("kind", "question").first() is not None


async def _settle_pending_permissions(agent: Agent) -> None:
    for permission in await _pending(agent).where("kind", "permission").get():
        await _mark_answered(permission.id, None)


async def _mark_answered(question_id: int, answer: str | None) -> None:
    await AgentQuestion.where("id", question_id).update(
        {
            "status": "answered",
            "answer": answer,
            "answered_at": utc_now(),
            "updated_at": utc_now(),
        }
    )


def _pending(agent: Agent):
    return AgentQuestion.where("agent_id", agent.id).where("status", "pending")


def _questions_for(agent: Agent, tool_use_id: str):
    return AgentQuestion.where("agent_id", agent.id).where("tool_use_id", tool_use_id)
