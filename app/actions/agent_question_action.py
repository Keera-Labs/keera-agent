from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.requests.agent_hook_event_request import AgentHookEventRequest


async def record_agent_questions(agent: Agent, event: AgentHookEventRequest) -> None:
    if event.asks_user_question():
        await _store_asked(agent, event)
    elif event.answers_user_question():
        await _store_answers(agent, event)


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
        await AgentQuestion.where("id", question.id).update(
            {
                "status": "answered",
                "answer": answers.get(question.question),
                "answered_at": utc_now(),
                "updated_at": utc_now(),
            }
        )


def _questions_for(agent: Agent, tool_use_id: str):
    return AgentQuestion.where("agent_id", agent.id).where("tool_use_id", tool_use_id)
