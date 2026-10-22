import asyncio
import json
import os
import socket
import time
import uuid
from pathlib import Path

from fastapi_startkit import Config
from fastapi_startkit.logging import Logger

from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.Handoff import Handoff
from app.models.Project import Project
from app.models.Server import Server
from app.models.Task import Task
from app.services.claude_config_dir import agent_config_dir, default_config_dir
from app.services.handoff import git_snapshot, transcript
from app.services.handoff.client import HandoffClient
from app.services.handoff.errors import HandoffConflict, HandoffError, HandoffInvalid
from app.services.handoff.state import agents_in_flight


class AgentHandoffPushAction:
    def __init__(self, agent_id: int, server_id: int, client: HandoffClient | None = None):
        self.agent_id = agent_id
        self.server_id = server_id
        self.client = client

    async def execute(self) -> Handoff:
        agent = await Agent.find_or_fail(self.agent_id)
        if getattr(agent, "deleted_at", None):
            raise HandoffInvalid(f"{agent.name} was deleted.")
        server = await Server.find_or_fail(self.server_id)
        project = await Project.find_or_fail(agent.project_id)
        self._ensure_movable(agent)
        if agent.id in agents_in_flight:
            raise HandoffConflict(f"{agent.name} is already being handed off.")
        agents_in_flight.add(agent.id)
        try:
            return await self._hand_off(agent, server, project)
        finally:
            agents_in_flight.discard(agent.id)

    @staticmethod
    def _ensure_movable(agent: Agent) -> None:
        if getattr(agent, "handed_off_at", None):
            raise HandoffConflict(f"{agent.name} was already handed off to {agent.handed_off_to}.")
        if (getattr(agent, "provider", None) or "codex") != "claude":
            raise HandoffInvalid("Only Claude agents can be handed off for now.")
        if not getattr(agent, "use_worktree", True):
            raise HandoffInvalid("Only agents that work in their own worktree can be handed off.")

    async def _hand_off(self, agent: Agent, server: Server, project: Project) -> Handoff:
        client = self.client or HandoffClient(server.base_url, server.token)
        await client.ping()

        from app.controllers.agent_trigger_controller import discover_agent_worktree

        project_path = os.path.expanduser(project.path)
        located = await asyncio.to_thread(discover_agent_worktree, project_path, agent.id)
        if not located:
            raise HandoffInvalid(f"{agent.name} has no worktree to hand off.")
        worktree = located[0]
        config_dir = await agent_config_dir(agent, project) or default_config_dir()
        session_dir = transcript.transcript_dir(config_dir, worktree)
        if not transcript.latest_session_id(session_dir):
            raise HandoffInvalid(f"{agent.name} has no Claude conversation to hand off.")
        remote_url = await asyncio.to_thread(git_snapshot.remote_url, worktree)

        handoff = await Handoff.create(
            {
                "handoff_key": await self._handoff_key(agent.id, server.id),
                "direction": "outgoing",
                "agent_id": agent.id,
                "server_id": server.id,
                "peer_url": server.base_url,
                "status": "pending",
            }
        )
        try:
            await self._stop(agent)
            branch = f"handoff/agent-{agent.id}-{int(time.time())}"
            snapshot = await asyncio.to_thread(git_snapshot.take_snapshot, worktree, branch)
            await asyncio.to_thread(git_snapshot.push_snapshot, worktree, snapshot)
            session_id = transcript.latest_session_id(session_dir)
            files = await asyncio.to_thread(transcript.export_session, session_dir, session_id)
            payload = await self._payload(
                handoff,
                agent,
                remote_url,
                snapshot,
                session_id,
                files,
                worktree,
                project_path,
                config_dir,
            )
            result = await client.send(payload)
        except HandoffError as exc:
            await self._record_failure(handoff, exc)
            raise

        Logger.info(
            f"Agent {agent.id} handed off to server {server.id} as agent {result.get('agent_id')}"
        )
        return await self._record_success(handoff, agent, server, snapshot, session_id, result)

    @staticmethod
    async def _handoff_key(agent_id: int, server_id: int) -> str:
        retry = (
            await Handoff.where("agent_id", agent_id)
            .where("server_id", server_id)
            .where("direction", "outgoing")
            .where("status", "failed")
            .order_by("id", "desc")
            .first()
        )
        return retry.handoff_key if retry else str(uuid.uuid4())

    @staticmethod
    async def _stop(agent: Agent) -> None:
        from app.controllers.agent_controller import stop_agent_session

        current = await Agent.find(agent.id)
        await stop_agent_session(current.session_id if current else agent.session_id)
        await Agent.where("id", agent.id).update(
            {"session_id": None, "status": "idle", "updated_at": utc_now()}
        )

    async def _payload(
        self,
        handoff,
        agent,
        remote_url,
        snapshot,
        session_id,
        files,
        worktree,
        project_path,
        config_dir,
    ) -> dict:
        task = await Task.find(agent.task_id) if getattr(agent, "task_id", None) else None
        return {
            "handoff_key": handoff.handoff_key,
            "source": {
                "name": Config.get("fastapi.server_name") or socket.gethostname(),
                "base_url": Config.get("fastapi.app_url"),
            },
            "agent": {
                "source_agent_id": agent.id,
                "name": agent.name,
                "agent_type": agent.agent_type,
                "provider": "claude",
                "model": agent.model,
                "description": agent.description,
                "system_prompt": agent.system_prompt,
                "flags": _flags(agent.flags),
                "dangerously_skip_permissions": bool(agent.dangerously_skip_permissions),
                "plan_mode": bool(agent.plan_mode),
                "complexity": _complexity(task),
                "task": {"id": task.id, "title": task.title} if task else None,
            },
            "git": {"remote_url": remote_url, **snapshot.to_dict()},
            "transcript": {"session_id": session_id, "files": files},
            "paths": {
                "worktree": worktree,
                "project": project_path,
                "home": str(Path.home()),
                "config_dir": config_dir,
            },
        }

    @staticmethod
    async def _record_failure(handoff: Handoff, exc: HandoffError) -> None:
        Logger.warning(f"Handoff {handoff.id} of agent {handoff.agent_id} failed: {exc.message}")
        await Handoff.where("id", handoff.id).update(
            {"status": "failed", "error": exc.message, "updated_at": utc_now()}
        )

    @staticmethod
    async def _record_success(handoff, agent, server, snapshot, session_id, result) -> Handoff:
        now = utc_now()
        remote_agent_id = result.get("agent_id")
        await Handoff.where("id", handoff.id).update(
            {
                "status": "completed",
                "remote_agent_id": remote_agent_id,
                "branch": snapshot.branch,
                "session_id": session_id,
                "error": None,
                "updated_at": now,
            }
        )
        await Agent.where("id", agent.id).update(
            {
                "status": "handed_off",
                "handed_off_at": now,
                "handed_off_to": f"{server.name} (agent #{remote_agent_id})",
                "handed_off_url": result.get("url"),
                "current_activity": f"Handed off to {server.name}",
                "updated_at": now,
            }
        )
        return await Handoff.find(handoff.id)


def _flags(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _complexity(task) -> str:
    value = getattr(task, "complexity", None)
    return getattr(value, "value", value) or "medium"
