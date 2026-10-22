import asyncio
import datetime
import os
from pathlib import Path

from fastapi_startkit import Config
from fastapi_startkit.logging import Logger
from sqlalchemy.exc import IntegrityError

from app.actions.agent_create_action import AgentCreateAction
from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.Handoff import Handoff
from app.models.Project import Project
from app.requests.agent_requests import AgentStoreRequest
from app.requests.handoff_request import HandoffAgentSettings, IncomingHandoffRequest
from app.services.claude_config_dir import agent_config_dir, default_config_dir
from app.services.handoff import git_snapshot, transcript
from app.services.handoff.errors import HandoffConflict, HandoffError, HandoffInvalid
from app.services.handoff.tasks import heartbeat, run_in_background
from app.services.handoff.urls import rewrite_keera_urls

IMPORT_TTL = datetime.timedelta(minutes=15)
SLOT_ATTEMPTS = 5


async def plan_target(remote_url: str, settings: HandoffAgentSettings) -> tuple[Project, str]:
    project = await _matching_project(remote_url)
    model = await _target_model(settings)
    store = _store_request(settings, model, name="handoff preflight")
    try:
        await AgentCreateAction(project_id=project.id, request=store).validate()
    except ValueError as exc:
        raise HandoffInvalid(str(exc)) from exc
    return project, model


async def _matching_project(remote_url: str) -> Project:
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


async def _target_model(settings: HandoffAgentSettings) -> str:
    from app.controllers.global_settings_controller import (
        complexity_model,
        provider_model_is_configured,
    )

    if await provider_model_is_configured(settings.provider, settings.model):
        return settings.model
    fallback = await complexity_model(settings.provider, settings.complexity)
    if await provider_model_is_configured(settings.provider, fallback):
        return fallback
    raise HandoffInvalid(
        f"Neither {settings.model} nor the {settings.complexity} default is configured "
        f"for {settings.provider} on this server."
    )


def _store_request(settings: HandoffAgentSettings, model: str, **fields) -> AgentStoreRequest:
    return AgentStoreRequest(
        provider=settings.provider, model=model, complexity=settings.complexity, **fields
    )


def model_notice(requested: str, used: str) -> str | None:
    if requested == used:
        return None
    return f"{requested} is not configured on this server, so the agent runs on {used}."


def _stale_before() -> str:
    return (datetime.datetime.now(datetime.UTC) - IMPORT_TTL).strftime("%Y-%m-%d %H:%M:%S")


class AgentHandoffImportAction:
    def __init__(self, request: IncomingHandoffRequest, spawn: bool = True):
        self.request = request
        self.spawn = spawn
        self.notice: str | None = None

    async def execute(self) -> dict:
        replay = await self._replayable()
        if replay:
            return await self._result(replay.agent_id, replayed=True, notice=replay.notice)
        claim = await self._claim_key()
        try:
            async with heartbeat(lambda: self._keep_claim(claim)):
                return await self._import(claim)
        except Exception:
            await Handoff.where("id", claim.id).delete()
            raise

    def _key_query(self):
        return Handoff.where("handoff_key", self.request.handoff_key).where("direction", "incoming")

    async def _replayable(self) -> Handoff | None:
        existing = await self._key_query().first()
        if not existing:
            return None
        if existing.status == "completed":
            agent = await Agent.find(existing.agent_id)
            if agent and not getattr(agent, "deleted_at", None):
                return existing
            await Handoff.where("id", existing.id).delete()
            return None
        if str(existing.updated_at)[:19] >= _stale_before():
            raise HandoffConflict("This handoff is already being imported.")
        await Handoff.where("id", existing.id).delete()
        return None

    async def _claim_key(self) -> Handoff:
        req = self.request
        now = utc_now()
        try:
            return await Handoff.create(
                {
                    "handoff_key": req.handoff_key,
                    "direction": "incoming",
                    "agent_id": 0,
                    "peer_url": req.source.base_url,
                    "remote_agent_id": req.agent.source_agent_id,
                    "branch": req.git.branch,
                    "session_id": req.transcript.session_id,
                    "status": "importing",
                    "created_at": now,
                    "updated_at": now,
                }
            )
        except IntegrityError as exc:
            raise HandoffConflict("This handoff is already being imported.") from exc

    async def _import(self, claim: Handoff) -> dict:
        req = self.request
        project, model = await plan_target(req.git.remote_url, req.agent)
        self.notice = model_notice(req.agent.model, model)
        project_path = os.path.expanduser(project.path)
        agent, worktree, local_branch = await self._agent_with_free_slot(project, model)
        checked_out = False
        installed: list[Path] = []
        try:
            await asyncio.to_thread(
                git_snapshot.checkout_snapshot,
                project_path,
                worktree,
                local_branch,
                req.git.model_dump(),
            )
            checked_out = True
            worktree = os.path.realpath(worktree)
            config_dir = await agent_config_dir(agent, project) or default_config_dir()
            installed = await asyncio.to_thread(
                transcript.install_session,
                transcript.transcript_dir(config_dir, worktree),
                req.transcript.session_id,
                [file.model_dump() for file in req.transcript.files],
                self._rewriter(worktree, project_path, config_dir),
            )
            await self._activate(agent, claim)
        except Exception:
            await self._discard(agent, project_path, worktree, local_branch, checked_out, installed)
            raise

        Logger.info(
            f"Agent {agent.id} imported from {req.source.base_url} (handoff {req.handoff_key})"
        )
        if self.spawn:
            await self._resume(agent.id, project, worktree, local_branch)
        return await self._result(agent.id, replayed=False, notice=self.notice)

    @staticmethod
    async def _keep_claim(claim: Handoff) -> None:
        await Handoff.where("id", claim.id).update({"updated_at": utc_now()})

    async def _activate(self, agent: Agent, claim: Handoff) -> None:
        await Agent.where("id", agent.id).update(
            {"resume_session_id": self.request.transcript.session_id, "has_session": True}
        )
        await Handoff.where("id", claim.id).update(
            {
                "agent_id": agent.id,
                "status": "completed",
                "notice": self.notice,
                "updated_at": utc_now(),
            }
        )

    async def _agent_with_free_slot(self, project: Project, model: str):
        project_path = os.path.expanduser(project.path)
        for _ in range(SLOT_ATTEMPTS):
            agent = await self._create_agent(project, model)
            worktree = os.path.join(project_path, ".claude", "worktrees", f"agent-{agent.id}")
            local_branch = f"worktree-agent-{agent.id}"
            taken = await asyncio.to_thread(
                git_snapshot.checkout_slot_taken, project_path, worktree, local_branch
            )
            if not taken:
                return agent, worktree, local_branch
            Logger.warning(f"Handoff skipped agent id {agent.id}: its worktree slot is in use")
            await Agent.where("id", agent.id).update({"deleted_at": utc_now()})
        raise HandoffConflict("No free agent worktree slot on this server; prune old worktrees.")

    async def _create_agent(self, project: Project, model: str) -> Agent:
        meta = self.request.agent
        store = _store_request(
            meta,
            model,
            name=meta.name,
            agent_type=meta.agent_type,
            description=meta.description,
            system_prompt=self._system_prompt(),
            flags=meta.flags,
            dangerously_skip_permissions=meta.dangerously_skip_permissions,
            plan_mode=meta.plan_mode,
        )
        try:
            return await AgentCreateAction(project_id=project.id, request=store).execute()
        except ValueError as exc:
            raise HandoffInvalid(str(exc)) from exc

    def _system_prompt(self) -> str | None:
        meta = self.request.agent
        if meta.system_prompt_is_default or not (meta.system_prompt or "").strip():
            return None
        return rewrite_keera_urls(
            meta.system_prompt, self.request.source.base_url, Config.get("fastapi.app_url")
        )

    def _rewriter(self, worktree: str, project_path: str, config_dir: str):
        paths = self.request.paths
        return transcript.PathRewriter(
            {
                paths.worktree: worktree,
                paths.project: project_path,
                paths.config_dir: config_dir,
                transcript.encoded_dir_name(paths.worktree): transcript.encoded_dir_name(worktree),
                transcript.encoded_dir_name(paths.project): transcript.encoded_dir_name(
                    project_path
                ),
                paths.home: str(Path.home()),
            }
        )

    @staticmethod
    async def _discard(agent, project_path, worktree, local_branch, checked_out, installed) -> None:
        await Agent.where("id", agent.id).update({"deleted_at": utc_now()})
        for path in installed:
            path.unlink(missing_ok=True)
        if checked_out:
            await asyncio.to_thread(
                git_snapshot.remove_checkout, project_path, worktree, local_branch
            )

    async def _resume(
        self, agent_id: int, project: Project, worktree: str, local_branch: str
    ) -> None:
        from app.controllers.agent_trigger_controller import _spawn_headless_agent

        agent = await Agent.find(agent_id)
        cwd = os.path.expanduser(project.path)
        run_in_background(
            _spawn_headless_agent(
                agent, project, cwd, self._resume_note(agent, worktree, local_branch)
            )
        )

    def _model_hint(self) -> str:
        return f"{self.notice} " if self.notice else ""

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
            f"{self._model_hint()}Continue your task from where you left off."
        )

    @staticmethod
    async def _result(agent_id: int, replayed: bool, notice: str | None) -> dict:
        agent = await Agent.find(agent_id)
        project = await Project.find(agent.project_id)
        base_url = Config.get("fastapi.app_url").rstrip("/")
        return {
            "agent_id": agent.id,
            "project_id": project.id,
            "url": f"{base_url}/{project.slug}/agents/{agent.id}",
            "replayed": replayed,
            "notice": notice,
        }
