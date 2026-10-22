import asyncio
import json
import logging
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
from app.services.handoff.errors import (
    HandoffConflict,
    HandoffError,
    HandoffInvalid,
    HandoffTargetRejected,
)
from app.services.handoff.state import claim_agent, refresh_claim, release_claim
from app.services.handoff.tasks import heartbeat, run_in_background

logger = logging.getLogger("keera.handoff")


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
        self.claim = await claim_agent(agent.id)
        if not self.claim:
            raise HandoffConflict(f"{agent.name} is already being handed off.")
        try:
            async with heartbeat(lambda: refresh_claim(agent.id, self.claim)):
                return await self._hand_off(await Agent.find(agent.id), server, project)
        finally:
            await release_claim(agent.id, self.claim)

    @staticmethod
    def _ensure_movable(agent: Agent) -> None:
        if getattr(agent, "handed_off_at", None):
            raise HandoffConflict(f"{agent.name} was already handed off to {agent.handed_off_to}.")
        if (getattr(agent, "provider", None) or "codex") != "claude":
            raise HandoffInvalid("Only Claude agents can be handed off for now.")
        if not getattr(agent, "use_worktree", True):
            raise HandoffInvalid("Only agents that work in their own worktree can be handed off.")

    async def _hand_off(self, agent: Agent, server: Server, project: Project) -> Handoff:
        from app.controllers.agent_trigger_controller import discover_agent_worktree

        client = self.client or HandoffClient(server.base_url, server.token)
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
        await asyncio.to_thread(git_snapshot.check_secrets, worktree)
        task = await Task.find(agent.task_id) if getattr(agent, "task_id", None) else None
        settings = {"provider": "claude", "model": agent.model, "complexity": _complexity(task)}
        await client.preflight({"remote_url": remote_url, "agent": settings})

        handoff = await self._open_handoff(agent.id, server)
        progress = _Progress(was_live=await self._stop(agent))
        try:
            branch = f"handoff/agent-{agent.id}-{int(time.time())}"
            snapshot = await asyncio.to_thread(git_snapshot.take_snapshot, worktree, branch)
            await asyncio.to_thread(git_snapshot.push_snapshot, worktree, snapshot)
            progress.pushed_branch = branch
            session_id = transcript.latest_session_id(session_dir)
            files = await asyncio.to_thread(transcript.export_session, session_dir, session_id)
            payload = self._payload(handoff, agent, task, settings, remote_url, snapshot)
            payload["transcript"] = {"session_id": session_id, "files": files}
            payload["paths"] = {
                "worktree": worktree,
                "project": project_path,
                "home": str(Path.home()),
                "config_dir": config_dir,
            }
            progress.sending = True
            result = await client.send(payload)
        except Exception as exc:
            await self._compensate(handoff, agent, server, project, worktree, progress, exc)
            raise

        Logger.info(
            f"Agent {agent.id} handed off to server {server.id} as agent {result.get('agent_id')}"
        )
        return await self._record_success(handoff, agent, server, snapshot, session_id, result)

    @staticmethod
    async def _open_handoff(agent_id: int, server: Server) -> Handoff:
        retry = (
            await Handoff.where("agent_id", agent_id)
            .where("server_id", server.id)
            .where("direction", "outgoing")
            .where("status", "failed")
            .order_by("id", "desc")
            .first()
        )
        if retry:
            await Handoff.where("id", retry.id).update(
                {"status": "pending", "error": None, "updated_at": utc_now()}
            )
            return await Handoff.find(retry.id)
        return await Handoff.create(
            {
                "handoff_key": str(uuid.uuid4()),
                "direction": "outgoing",
                "agent_id": agent_id,
                "server_id": server.id,
                "peer_url": server.base_url,
                "status": "pending",
            }
        )

    @staticmethod
    async def _stop(agent: Agent) -> bool:
        from fastapi_startkit.application import app

        from app.controllers.agent_controller import stop_agent_session

        session_id = agent.session_id
        was_live = bool(session_id and app().make("terminal").find(session_id))
        await stop_agent_session(session_id)
        await Agent.where("id", agent.id).update(
            {"session_id": None, "status": "idle", "updated_at": utc_now()}
        )
        return was_live

    @staticmethod
    def _payload(handoff, agent, task, settings, remote_url, snapshot) -> dict:
        from app.utils.system_prompts import default_system_prompt

        prompt = agent.system_prompt or ""
        return {
            "handoff_key": handoff.handoff_key,
            "source": {
                "name": Config.get("fastapi.server_name") or socket.gethostname(),
                "base_url": Config.get("fastapi.app_url"),
            },
            "agent": {
                **settings,
                "source_agent_id": agent.id,
                "name": agent.name,
                "agent_type": agent.agent_type,
                "description": agent.description,
                "system_prompt": prompt,
                "system_prompt_is_default": prompt.strip()
                == default_system_prompt(agent.agent_type).strip(),
                "flags": _flags(agent.flags),
                "dangerously_skip_permissions": bool(agent.dangerously_skip_permissions),
                "plan_mode": bool(agent.plan_mode),
                "task": {"id": task.id, "title": task.title} if task else None,
            },
            "git": {"remote_url": remote_url, **snapshot.to_dict()},
        }

    async def _compensate(self, handoff, agent, server, project, worktree, progress, exc) -> None:
        message = exc.message if isinstance(exc, HandoffError) else "Unexpected handoff failure."
        if not isinstance(exc, HandoffError):
            logger.exception("Handoff %s of agent %s failed", handoff.id, agent.id)
        Logger.warning(f"Handoff {handoff.id} of agent {agent.id} failed: {message}")
        if progress.pushed_branch:
            await asyncio.to_thread(
                git_snapshot.delete_remote_branch, worktree, progress.pushed_branch
            )
        uncertain = progress.sending and not isinstance(exc, HandoffTargetRejected)
        retry_hint = " The target may have accepted it; push again to confirm." if uncertain else ""
        await Handoff.where("id", handoff.id).update(
            {
                "status": "failed",
                "error": message + retry_hint,
                "branch": progress.pushed_branch,
                "updated_at": utc_now(),
            }
        )
        if progress.was_live and not uncertain:
            await release_claim(agent.id, self.claim)
            await self._resume_source(agent, server, project, message)

    @staticmethod
    async def _resume_source(agent, server, project, message: str) -> None:
        from app.controllers.agent_trigger_controller import _spawn_headless_agent

        note = (
            f"[Keera handoff] Moving you to {server.name} failed ({message}). You are still on "
            "this server with your worktree unchanged; continue your task from where you left off."
        )
        fresh = await Agent.find(agent.id)
        run_in_background(
            _spawn_headless_agent(fresh, project, os.path.expanduser(project.path), note)
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
                "notice": result.get("notice"),
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


class _Progress:
    def __init__(self, was_live: bool):
        self.was_live = was_live
        self.pushed_branch: str | None = None
        self.sending = False


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
