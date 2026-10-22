import asyncio
import os
from pathlib import Path

from fastapi_startkit import Config
from fastapi_startkit.logging import Logger

from app.actions.agent_create_action import AgentCreateAction
from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.Handoff import Handoff
from app.models.Project import Project
from app.requests.agent_requests import AgentStoreRequest
from app.requests.handoff_request import IncomingHandoffRequest
from app.services.claude_config_dir import agent_config_dir, default_config_dir
from app.services.handoff import git_snapshot, transcript
from app.services.handoff.errors import HandoffError, HandoffInvalid

_key_locks: dict[str, asyncio.Lock] = {}


class AgentHandoffImportAction:
    def __init__(self, request: IncomingHandoffRequest, spawn: bool = True):
        self.request = request
        self.spawn = spawn

    async def execute(self) -> dict:
        lock = _key_locks.setdefault(self.request.handoff_key, asyncio.Lock())
        async with lock:
            existing = await self._completed()
            if existing:
                return await self._result(existing.agent_id, replayed=True)
            return await self._import()

    async def _completed(self) -> Handoff | None:
        return (
            await Handoff.where("handoff_key", self.request.handoff_key)
            .where("direction", "incoming")
            .where("status", "completed")
            .first()
        )

    async def _import(self) -> dict:
        req = self.request
        project = await self._matching_project(req.git.remote_url)
        project_path = os.path.expanduser(project.path)
        agent = await self._create_agent(project)
        worktree = os.path.join(project_path, ".claude", "worktrees", f"agent-{agent.id}")
        local_branch = f"worktree-agent-{agent.id}"
        written: list[Path] = []
        try:
            await asyncio.to_thread(
                git_snapshot.checkout_snapshot,
                project_path,
                worktree,
                local_branch,
                req.git.model_dump(),
            )
            worktree = os.path.realpath(worktree)
            config_dir = await agent_config_dir(agent, project) or default_config_dir()
            rewriter = transcript.PathRewriter(
                {
                    req.paths.worktree: worktree,
                    req.paths.project: project_path,
                    req.paths.config_dir: config_dir,
                    transcript.encoded_dir_name(req.paths.worktree): transcript.encoded_dir_name(
                        worktree
                    ),
                    req.paths.home: str(Path.home()),
                }
            )
            written = await asyncio.to_thread(
                transcript.install_session,
                transcript.transcript_dir(config_dir, worktree),
                req.transcript.session_id,
                [file.model_dump() for file in req.transcript.files],
                rewriter,
            )
            await Agent.where("id", agent.id).update(
                {"resume_session_id": req.transcript.session_id, "has_session": True}
            )
            await Handoff.create(
                {
                    "handoff_key": req.handoff_key,
                    "direction": "incoming",
                    "agent_id": agent.id,
                    "peer_url": req.source.base_url,
                    "remote_agent_id": req.agent.source_agent_id,
                    "branch": req.git.branch,
                    "session_id": req.transcript.session_id,
                    "status": "completed",
                }
            )
        except Exception:
            await self._discard(agent, project_path, worktree, local_branch, written)
            raise

        Logger.info(
            f"Agent {agent.id} imported from {req.source.base_url} (handoff {req.handoff_key})"
        )
        if self.spawn:
            await self._resume(agent.id, project, worktree, local_branch)
        return await self._result(agent.id, replayed=False)

    async def _matching_project(self, remote_url: str) -> Project:
        wanted = git_snapshot.normalize_remote(remote_url)
        for project in await Project.all():
            path = os.path.expanduser(project.path or "")
            if not os.path.isdir(path):
                continue
            try:
                url = await asyncio.to_thread(git_snapshot.remote_url, path)
            except HandoffError:
                continue
            if git_snapshot.normalize_remote(url) == wanted:
                return project
        raise HandoffInvalid("No project on this server uses the handed-off repository's remote.")

    async def _create_agent(self, project: Project) -> Agent:
        meta = self.request.agent
        store = AgentStoreRequest(
            name=meta.name,
            agent_type=meta.agent_type,
            description=meta.description,
            provider=meta.provider,
            model=meta.model,
            system_prompt=meta.system_prompt,
            flags=meta.flags,
            dangerously_skip_permissions=meta.dangerously_skip_permissions,
            plan_mode=meta.plan_mode,
            complexity=meta.complexity,
        )
        try:
            return await AgentCreateAction(project_id=project.id, request=store).execute()
        except ValueError as exc:
            raise HandoffInvalid(str(exc)) from exc

    @staticmethod
    async def _discard(agent, project_path, worktree, local_branch, written) -> None:
        await Agent.where("id", agent.id).update({"deleted_at": utc_now()})
        if os.path.isdir(worktree):
            await asyncio.to_thread(
                git_snapshot.remove_checkout, project_path, worktree, local_branch
            )
        for path in written:
            path.unlink(missing_ok=True)

    async def _resume(
        self, agent_id: int, project: Project, worktree: str, local_branch: str
    ) -> None:
        from app.controllers.agent_trigger_controller import _spawn_headless_agent

        agent = await Agent.find(agent_id)
        cwd = os.path.expanduser(project.path)
        asyncio.create_task(
            _spawn_headless_agent(
                agent, project, cwd, self._resume_note(agent, worktree, local_branch)
            )
        )

    def _resume_note(self, agent: Agent, worktree: str, local_branch: str) -> str:
        req = self.request
        source_branch = req.git.source_branch
        push_hint = (
            f" Your work branch on the source was {source_branch}; publish to it with "
            f"`git push origin HEAD:{source_branch}`."
            if source_branch
            else ""
        )
        task = (
            f" You were working on the source's task #{req.agent.task.id}."
            if req.agent.task
            else ""
        )
        return (
            f"[Keera handoff] This conversation was moved from {req.source.name} "
            f"({req.source.base_url}) to this Keera server. You are now agent {agent.id} here "
            f"(you were agent {req.agent.source_agent_id} there), and the protocol above replaces "
            f"the old agent roster and relay URL. Your worktree is now {worktree} on branch "
            f"{local_branch}.{push_hint}{task} Uncommitted and untracked changes came with you; "
            f"git-ignored files such as .env and any running processes did not. "
            f"Continue your task from where you left off."
        )

    @staticmethod
    async def _result(agent_id: int, replayed: bool) -> dict:
        agent = await Agent.find(agent_id)
        project = await Project.find(agent.project_id)
        base_url = Config.get("fastapi.app_url").rstrip("/")
        return {
            "agent_id": agent.id,
            "project_id": project.id,
            "url": f"{base_url}/{project.slug}/agents/{agent.id}",
            "replayed": replayed,
        }
