from typing import Annotated

from fastapi import Header
from fastapi.responses import JSONResponse

from app.actions.agent_status_action import (
    CLEARED_ATTENTION,
    find_hook_agent,
    notify_agent_status,
    utc_now,
)
from app.models.Agent import Agent
from app.requests.agent_hook_event_request import AgentHookEventRequest


async def store(
    body: AgentHookEventRequest,
    x_keera_agent_id: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    """Receives Claude Code hooks that move an agent into or out of `needs_input`."""
    agent = await find_hook_agent(x_keera_agent_id, body.cwd)
    if agent:
        status = await _apply(agent, body)
        if status:
            await notify_agent_status(agent, status)
    # Claude Code parses an HTTP hook's response as hook output, so it must stay empty.
    return JSONResponse({})


async def _apply(agent: Agent, event: AgentHookEventRequest) -> str | None:
    """Persist the transition the event implies; the new status, or None if unchanged."""
    attention = event.attention()
    if attention:
        await Agent.where("id", agent.id).update(
            {
                "status": "needs_input",
                "attention_kind": attention.kind,
                "attention_prompt": attention.prompt,
                "updated_at": utc_now(),
            }
        )
        return "needs_input"

    # PostToolUse fires for every tool call, so only a blocked agent is touched; a
    # submitted prompt always means the agent is working again.
    resumes = event.resumes_work() and (
        agent.status == "needs_input" or event.hook_event_name == "UserPromptSubmit"
    )
    if not resumes:
        return None
    await Agent.where("id", agent.id).update(
        {"status": "running", **CLEARED_ATTENTION, "updated_at": utc_now()}
    )
    return "running" if agent.status != "running" else None
