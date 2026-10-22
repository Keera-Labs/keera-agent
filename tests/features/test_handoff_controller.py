import json
import os
from unittest import mock

import httpx
from fastapi_startkit import Config
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_handoff_push_action import AgentHandoffPushAction
from app.models.Agent import Agent
from app.models.Project import Project
from app.models.Server import Server
from app.services.handoff.client import HandoffClient
from app.services.handoff.transcript import transcript_dir
from databases.factories.project_factory import ProjectFactory
from databases.factories.workspace_factory import WorkspaceFactory
from tests.features.handoff_repos import SESSION_ID, HandoffRepos
from tests.test_case import TestCase

TOKEN = "target-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class TestHandoffController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._original_token = Config.get("fastapi.handoff_token")
        Config.set("fastapi.handoff_token", TOKEN)
        self.addCleanup(Config.set, "fastapi.handoff_token", self._original_token)
        spawn = mock.patch(
            "app.controllers.agent_trigger_controller._spawn_headless_agent",
            new_callable=mock.AsyncMock,
        )
        self.spawn = spawn.start()
        self.addCleanup(spawn.stop)

        self.repos = HandoffRepos(self)
        source = await self.repos.source_agent()
        self.payload = await self._exported_payload(source)
        await Project.where("id", self.repos.project.id).update({"path": "/nonexistent/source"})

        self.target_root = self.repos.clone("target")
        workspace = await WorkspaceFactory.new().create(claude_config_dir=self.repos.config_dir)
        self.target_project = await ProjectFactory.new().create(
            path=str(self.target_root), workspace_id=workspace.id
        )

    async def _exported_payload(self, agent) -> dict:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                captured.update(json.loads(request.content))
            return httpx.Response(200, json={"data": {"agent_id": 1}})

        server = await Server.create(
            {"name": "t", "kind": "local", "base_url": "http://t.test", "token": "x"}
        )
        client = HandoffClient(server.base_url, "x", transport=httpx.MockTransport(handler))
        await AgentHandoffPushAction(agent.id, server.id, client=client).execute()
        return captured

    async def _import(self, payload=None, headers=AUTH):
        return await self.post("/api/handoffs", json=payload or self.payload, headers=headers)

    def _git(self, *args, cwd):
        return self.repos.repo.git(*args, cwd=cwd)

    async def test_show_requires_the_handoff_token(self):
        (await self.get("/api/handoff")).assert_status(401)
        (await self.get("/api/handoff", headers={"Authorization": "Bearer nope"})).assert_status(
            401
        )
        response = await self.get("/api/handoff", headers=AUTH)
        response.assert_ok()
        self.assertIn("claude", response.json()["data"]["providers"])

    async def test_handoffs_are_disabled_without_a_configured_token(self):
        Config.set("fastapi.handoff_token", "")

        (await self.get("/api/handoff", headers=AUTH)).assert_status(403)
        (await self._import()).assert_status(403)

    async def test_import_requires_the_handoff_token(self):
        response = await self._import(headers={"Authorization": "Bearer wrong"})

        response.assert_status(401)
        self.assertFalse(os.path.exists(self.target_root / ".claude" / "worktrees"))

    async def test_import_recreates_the_worktree_and_resumable_conversation(self):
        response = await self._import()

        response.assert_ok()
        data = response.json()["data"]
        self.assertFalse(data["replayed"])
        agent = await Agent.find(data["agent_id"])
        self.assertEqual(agent.project_id, self.target_project.id)
        self.assertEqual(agent.name, "Mover")
        self.assertEqual(agent.resume_session_id, SESSION_ID)
        self.assertTrue(agent.has_session)
        self.assertTrue(data["url"].endswith(f"/{self.target_project.slug}/agents/{agent.id}"))

        worktree = (self.target_root / ".claude" / "worktrees" / f"agent-{agent.id}").resolve()
        self.assertEqual(
            self._git("rev-parse", "--abbrev-ref", "HEAD", cwd=worktree),
            f"worktree-agent-{agent.id}\n",
        )
        self.assertEqual(
            self._git("rev-parse", "HEAD", cwd=worktree).strip(), self.payload["git"]["base_sha"]
        )
        self.assertEqual((worktree / "committed.py").read_text(), "done = 1\n")
        self.assertEqual((worktree / "app.py").read_text(), "print('v2 uncommitted')\n")
        self.assertEqual((worktree / "notes.md").read_text(), "untracked notes\n")
        self.assertFalse((worktree / ".env").exists())
        status = self._git("status", "--porcelain", cwd=worktree)
        self.assertIn(" M app.py", status)
        self.assertIn("?? notes.md", status)

        directory = transcript_dir(self.repos.config_dir, str(worktree))
        entries = [
            json.loads(line)
            for line in (directory / f"{SESSION_ID}.jsonl").read_text().splitlines()
        ]
        self.assertEqual(entries[0]["cwd"], str(worktree))
        self.assertEqual(entries[1]["message"], f"edited {worktree}/app.py")
        self.assertEqual(
            (directory / SESSION_ID / "tool-results" / "out.txt").read_text(),
            f"ran in {worktree}\n",
        )

        self.spawn.assert_called_once()
        note = self.spawn.call_args.args[3]
        self.assertIn("[Keera handoff]", note)
        self.assertIn("task/feature", note)

    async def test_replaying_the_same_handoff_returns_the_same_agent(self):
        first = (await self._import()).json()["data"]

        second = await self._import()

        second.assert_ok()
        self.assertTrue(second.json()["data"]["replayed"])
        self.assertEqual(second.json()["data"]["agent_id"], first["agent_id"])
        self.assertEqual(
            await Agent.where("project_id", self.target_project.id)
            .where_null("deleted_at")
            .count(),
            1,
        )
        self.spawn.assert_called_once()

    async def test_import_without_a_matching_project_is_rejected(self):
        payload = {
            **self.payload,
            "git": {**self.payload["git"], "remote_url": "git@example.com:other/repo.git"},
        }

        response = await self._import(payload)

        response.assert_status(422)
        self.assertEqual(await Agent.where("project_id", self.target_project.id).count(), 0)

    async def test_a_failed_import_rolls_back_the_agent_and_worktree(self):
        files = [*self.payload["transcript"]["files"], {"path": "../escape.jsonl", "content": "x"}]
        payload = {**self.payload, "transcript": {**self.payload["transcript"], "files": files}}

        response = await self._import(payload)

        response.assert_status(422)
        live = (
            await Agent.where("project_id", self.target_project.id).where_null("deleted_at").count()
        )
        self.assertEqual(live, 0)
        worktrees = self.target_root / ".claude" / "worktrees"
        self.assertEqual(list(worktrees.iterdir()) if worktrees.exists() else [], [])
        self.assertNotIn("worktree-agent-", self._git("branch", "--list", cwd=self.target_root))
        self.spawn.assert_not_called()

    async def test_import_rejects_a_malformed_payload(self):
        payload = {**self.payload, "git": {**self.payload["git"], "branch": "--upload-pack=evil"}}

        (await self._import(payload)).assert_status(422)
