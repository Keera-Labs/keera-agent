import contextlib
import contextvars
import hashlib
import secrets
from dataclasses import dataclass

from app.models.Agent import Agent

AGENT_TOKEN_ENV = "KEERA_AGENT_TOKEN"
AGENT_TOKEN_HEADER = "X-Keera-Agent-Token"
TOKEN_PROVIDERS = frozenset({"claude", "gemini"})


@dataclass(frozen=True)
class RelayCaller:
    agent: Agent | None = None
    token_presented: bool = False

    @property
    def rejected(self) -> bool:
        return self.token_presented and self.agent is None


_current_caller: contextvars.ContextVar[RelayCaller] = contextvars.ContextVar(
    "relay_caller", default=RelayCaller()
)


def current_caller() -> RelayCaller:
    return _current_caller.get()


@contextlib.contextmanager
def acting_as(caller: RelayCaller):
    reset_token = _current_caller.set(caller)
    try:
        yield caller
    finally:
        _current_caller.reset(reset_token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def issue_agent_token(agent_id: int) -> str:
    token = secrets.token_urlsafe(32)
    await Agent.where("id", agent_id).update({"relay_token_hash": hash_token(token)})
    return token


async def resolve_caller(token: str | None) -> RelayCaller:
    token = (token or "").strip()
    if not token:
        return RelayCaller()
    agent = (
        await Agent.where("relay_token_hash", hash_token(token)).where_null("deleted_at").first()
    )
    return RelayCaller(agent=agent, token_presented=True)


async def every_live_agent_carries_token(project_id: int) -> bool:
    agents = await Agent.where("project_id", project_id).where_null("deleted_at").get()
    live = [agent for agent in agents if agent.session_id]
    return bool(live) and all(
        agent.relay_token_hash and agent.provider in TOKEN_PROVIDERS for agent in live
    )
