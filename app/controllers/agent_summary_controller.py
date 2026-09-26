import datetime
from typing import Annotated

from fastapi import Query
from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.requests.agent_summary_request import AgentSummaryIndexRequest
from app.resources.agent_summary_resource import AgentSummaryResource

PREVIEW_LENGTH = 140
LOCAL_TZ = datetime.datetime.now().astimezone().tzinfo


async def index(query: Annotated[AgentSummaryIndexRequest, Query()]) -> ResourceCollection:
    """Agents of the given projects with a last-message preview, in two queries total."""
    if not query.project_ids:
        return ResourceCollection([])

    agents = await (
        Agent.where_in("project_id", query.project_ids)
        .where_null("deleted_at")
        .order_by("id", "asc")
        .get()
    )
    latest = await _latest_messages([agent.id for agent in agents])

    return ResourceCollection([_summarize(agent, latest.get(agent.id)) for agent in agents])


async def _latest_messages(agent_ids: list[int]) -> dict[int, AgentRelayMessage]:
    if not agent_ids:
        return {}
    placeholders = ",".join("?" * len(agent_ids))
    messages = await AgentRelayMessage.where_raw(
        "id IN (SELECT MAX(id) FROM agent_relay_messages "
        f"WHERE to_agent_id IN ({placeholders}) GROUP BY to_agent_id)",
        agent_ids,
    ).get()
    return {message.to_agent_id: message for message in messages}


def _summarize(agent: Agent, message: AgentRelayMessage | None) -> AgentSummaryResource:
    # current_activity is what the agent is doing now; once it stops, fall back to
    # the last instruction it received.
    preview = agent.current_activity or (message.content if message else None)
    # started_at is written in local time, ORM timestamps in UTC.
    stamps = [
        _aware(agent.started_at, LOCAL_TZ),
        _aware(agent.updated_at, datetime.UTC),
        _aware(message.created_at, datetime.UTC) if message else None,
    ]
    last_activity = max((s for s in stamps if s), default=None)
    return AgentSummaryResource(
        agent,
        last_message=" ".join(preview.split())[:PREVIEW_LENGTH] if preview else None,
        last_activity_at=last_activity.isoformat() if last_activity else None,
    )


def _aware(value, naive_tz) -> datetime.datetime | None:
    if not value:
        return None
    try:
        dt = (
            value
            if isinstance(value, datetime.datetime)
            else datetime.datetime.fromisoformat(str(value))
        )
    except ValueError:
        return None
    dt = dt if dt.tzinfo else dt.replace(tzinfo=naive_tz)
    return dt.astimezone(datetime.UTC)
