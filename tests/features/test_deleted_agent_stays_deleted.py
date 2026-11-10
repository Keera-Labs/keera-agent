import asyncio
import os
import tempfile
import uuid

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_delete_action import AgentDeleteAction
from app.actions.agent_health_action import probe_agent
from app.actions.claude_hook_action import agent_env
from app.controllers.agent_hook_event_controller import _apply
from app.controllers.claude_hook_controller import _mark_stopped_agent_waiting
from app.mcp.tools import (
    DeleteAgentTool,
    GetOrchestratedAgentsTool,
    HeartbeatTool,
    ListAgentsTool,
)
from app.models.Agent import Agent
from app.requests.agent_hook_event_request import AgentHookEventRequest
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase

HOOK_EVENTS = [
    {"hook_event_name": "PostToolUse", "tool_name": "Bash"},
    {"hook_event_name": "UserPromptSubmit", "prompt": "keep going"},
    {
        "hook_event_name": "Notification",
        "notification_type": "permission_prompt",
        "message": "Bash?",
    },
    {
        "hook_event_name": "PreToolUse",
        "tool_name": "AskUserQuestion",
        "tool_use_id": "toolu_ask",
        "tool_input": {"questions": [{"question": "Ship it?", "header": "Q", "options": []}]},
    },
]


def _text(response) -> str:
    return response.to_content()[0]["text"]


class TestDeletedAgentStaysDeleted(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cwd = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self.cwd)
        self.orchestrator = await AgentFactory.new().create(project_id=self.project.id)
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, orchestrator_id=self.orchestrator.id, status="running"
        )
        self.loaded_before_delete = await Agent.find(self.agent.id)
        await AgentDeleteAction(self.agent, "done").execute()

    async def _post_hook(self, event: dict):
        response = await self.post(
            "/api/agent-hook-events",
            json={"cwd": self.cwd, **event},
            headers={"X-Keera-Agent-Id": str(self.agent.id)},
        )
        response.assert_ok()

    async def _assert_still_deleted(self):
        agent = await Agent.find(self.agent.id)
        self.assertIsNotNone(agent.deleted_at)
        self.assertEqual(agent.status, "deleted")
        self.assertIsNone(agent.last_heartbeat_at)

        listed = _text(await ListAgentsTool().handle({"project_path": self.cwd}))
        self.assertNotIn(f"ID: {self.agent.id},", listed)
        orchestrated = _text(
            await GetOrchestratedAgentsTool().handle({"agent_id": self.orchestrator.id})
        )
        self.assertNotIn(f'"id": {self.agent.id},', orchestrated)
        live = await Agent.where("project_id", self.project.id).where_null("deleted_at").count()
        self.assertEqual(live, 1)

    async def test_attributed_hook_events_leave_a_deleted_agent_deleted(self):
        for event in HOOK_EVENTS:
            await self._post_hook(event)

        await self._assert_still_deleted()

    async def test_attributed_stop_leaves_a_deleted_agent_deleted(self):
        response = await self.post(
            "/api/claude-stopped",
            json={"cwd": self.cwd},
            headers={"X-Keera-Agent-Id": str(self.agent.id)},
        )
        response.assert_ok()
        await asyncio.sleep(0.1)

        await self._assert_still_deleted()

    async def test_heartbeat_from_a_deleted_agent_is_refused(self):
        text = _text(await HeartbeatTool().handle({"agent_id": self.agent.id, "note": "alive"}))

        self.assertIn("not found", text)
        await self._assert_still_deleted()

    async def test_a_hook_event_racing_the_delete_does_not_revive_the_agent(self):
        for event in HOOK_EVENTS:
            await _apply(self.loaded_before_delete, AgentHookEventRequest(cwd=self.cwd, **event))

        await self._assert_still_deleted()

    async def test_a_stop_racing_the_delete_does_not_revive_the_agent(self):
        await Agent.where("id", self.agent.id).update({"status": "running"})

        await _mark_stopped_agent_waiting(self.agent.id)

        self.assertEqual((await Agent.find(self.agent.id)).status, "running")

    async def test_deleted_agent_is_hidden_from_get_orchestrated_agents(self):
        text = _text(await GetOrchestratedAgentsTool().handle({"agent_id": self.orchestrator.id}))

        self.assertIn("not orchestrated any agents", text)


class TestWorktreeProbeOfDeletedAgent(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("README.md", "hello")
        self.repo.commit_all("init")
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))
        self.agent = await AgentFactory.new().create(project_id=self.project.id)

    async def test_a_probe_racing_the_delete_writes_nothing(self):
        worktree = self.repo.root / ".claude" / "worktrees" / f"agent-{self.agent.id}"
        self.repo.git("worktree", "add", "-q", "-b", "task/probe", str(worktree))
        loaded_before_delete = await Agent.find(self.agent.id)
        await AgentDeleteAction(self.agent).execute()

        await probe_agent(loaded_before_delete)

        agent = await Agent.find(self.agent.id)
        self.assertIsNone(agent.worktree_head_sha)
        self.assertEqual(agent.status, "deleted")


class TestDeleteStopsEveryAgentTerminal(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cwd = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self.cwd)
        self.agent = await AgentFactory.new().create(project_id=self.project.id, use_worktree=False)
        self.terminals = app().make("terminal")

    def _open_terminal(self, agent_id: int) -> str:
        session_id = str(uuid.uuid4())
        env = {**os.environ, **agent_env(agent_id)}
        self.terminals.create(shell="/bin/sh", cwd=self.cwd, session_id=session_id, env=env)
        self.addAsyncCleanup(self.terminals.close, session_id)
        return session_id

    async def test_delete_closes_terminals_the_agent_row_no_longer_points_at(self):
        orphaned = self._open_terminal(self.agent.id)
        current = self._open_terminal(self.agent.id)
        other_agent = self._open_terminal(self.agent.id + 100000)
        await Agent.where("id", self.agent.id).update({"session_id": current})

        response = await self.client.delete(f"/api/agents/{self.agent.id}")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.terminals.find(orphaned))
        self.assertIsNone(self.terminals.find(current))
        self.assertIsNotNone(self.terminals.find(other_agent))

    async def test_mcp_delete_closes_every_agent_terminal(self):
        orphaned = self._open_terminal(self.agent.id)

        text = _text(await DeleteAgentTool().handle({"agent_id": self.agent.id}))

        self.assertIn("has been deleted", text)
        self.assertIsNone(self.terminals.find(orphaned))
