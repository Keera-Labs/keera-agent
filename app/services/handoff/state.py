import datetime
import uuid

from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent

CLAIM_TTL = datetime.timedelta(minutes=15)
_FORMAT = "%Y-%m-%d %H:%M:%S"


def _stale_before() -> str:
    return (datetime.datetime.now(datetime.UTC) - CLAIM_TTL).strftime(_FORMAT)


def claim_is_live(agent) -> bool:
    claimed_at = getattr(agent, "handoff_claimed_at", None)
    if not getattr(agent, "handoff_claim", None) or not claimed_at:
        return False
    return str(claimed_at)[:19] >= _stale_before()


def is_handed_off(agent) -> bool:
    return bool(getattr(agent, "handed_off_at", None)) or claim_is_live(agent)


async def claim_agent(agent_id: int) -> str | None:
    token = uuid.uuid4().hex
    await (
        Agent.where("id", agent_id)
        .where_null("handed_off_at")
        .where_raw("(handoff_claim IS NULL OR handoff_claimed_at < ?)", [_stale_before()])
        .update({"handoff_claim": token, "handoff_claimed_at": utc_now()})
    )
    claimed = await Agent.find(agent_id)
    return token if claimed and claimed.handoff_claim == token else None


async def release_claim(agent_id: int, token: str) -> None:
    await (
        Agent.where("id", agent_id)
        .where("handoff_claim", token)
        .update({"handoff_claim": None, "handoff_claimed_at": None})
    )
