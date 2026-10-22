import json
from unittest import mock

import httpx
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.Handoff import Handoff
from app.models.Server import Server
from app.services.handoff.client import HandoffClient
from app.services.handoff.state import agents_in_flight
from app.services.handoff.transcript import transcript_dir
from databases.factories.agent_factory import AgentFactory
from tests.features.handoff_repos import SESSION_ID, HandoffRepos
from tests.test_case import TestCase


class FakeTarget:
    def __init__(self, ping_status: int = 200, send_status: int = 200, down: bool = False):
        self.ping_status = ping_status
        self.send_status = send_status
        self.down = down
        self.payloads: list[dict] = []
        self.authorizations: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        self.authorizations.append(request.headers.get("authorization"))
        if request.method == "GET":
            return httpx.Response(self.ping_status, json={"data": {"name": "target"}})
        self.payloads.append(json.loads(request.content))
        if self.send_status != 200:
            return httpx.Response(self.send_status, json={"error": "target exploded"})
        return httpx.Response(
            200, json={"data": {"agent_id": 77, "url": "http://target.test/p/agents/77"}}
        )

    def client(self, base_url: str, token: str) -> HandoffClient:
        return HandoffClient(base_url, token, transport=httpx.MockTransport(self.handler))


class TestAgentHandoffController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repos = HandoffRepos(self)
        self.agent = await self.repos.source_agent()
        self.server = await Server.create(
            {
                "name": "Cloud box",
                "kind": "cloud",
                "base_url": "http://target.test",
                "token": "tok-123",
            }
        )
        self.target = FakeTarget()
        patcher = mock.patch(
            "app.actions.agent_handoff_push_action.HandoffClient", self.target.client
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    async def _push(self):
        return await self.post(
            f"/api/agents/{self.agent.id}/handoffs", json={"server_id": self.server.id}
        )

    def _worktree_state(self) -> tuple[str, str]:
        git = self.repos.repo.git
        return (
            git("rev-parse", "HEAD", cwd=self.repos.worktree),
            git("status", "--porcelain", cwd=self.repos.worktree),
        )

    async def test_push_sends_work_transcript_and_metadata_then_marks_the_agent(self):
        before = self._worktree_state()

        response = await self._push()

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["status"], "completed")
        self.assertEqual(attributes["remote_agent_id"], 77)
        self.assertEqual(self.target.authorizations, ["Bearer tok-123", "Bearer tok-123"])

        payload = self.target.payloads[0]
        self.assertEqual(payload["agent"]["name"], "Mover")
        self.assertEqual(payload["agent"]["source_agent_id"], self.agent.id)
        self.assertEqual(payload["agent"]["provider"], "claude")
        self.assertEqual(payload["transcript"]["session_id"], SESSION_ID)
        paths = sorted(file["path"] for file in payload["transcript"]["files"])
        self.assertEqual(paths, [f"{SESSION_ID}.jsonl", f"{SESSION_ID}/tool-results/out.txt"])
        self.assertEqual(payload["paths"]["worktree"], str(self.repos.worktree))
        self.assertEqual(payload["git"]["source_branch"], "task/feature")
        self.assertTrue(payload["git"]["wip"])
        self.assertTrue(payload["git"]["branch"].startswith(f"handoff/agent-{self.agent.id}-"))

        remote_tree = self.repos.repo.git(
            "ls-tree", "-r", "--name-only", payload["git"]["branch"], cwd=self.repos.remote
        ).split()
        self.assertIn("committed.py", remote_tree)
        self.assertIn("notes.md", remote_tree)
        self.assertNotIn(".env", remote_tree)
        pushed_app = self.repos.repo.git(
            "show", f"{payload['git']['branch']}:app.py", cwd=self.repos.remote
        )
        self.assertEqual(pushed_app, "print('v2 uncommitted')\n")

        self.assertEqual(self._worktree_state(), before)
        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.status, "handed_off")
        self.assertIsNotNone(agent.handed_off_at)
        self.assertEqual(agent.handed_off_to, "Cloud box (agent #77)")
        self.assertEqual(agent.handed_off_url, "http://target.test/p/agents/77")
        self.assertIsNone(agent.deleted_at)

    async def test_a_handed_off_agent_cannot_be_pushed_or_started_again(self):
        (await self._push()).assert_ok()

        (await self._push()).assert_status(409)
        trigger = await self.post(f"/api/agents/{self.agent.id}/trigger", json={"message": "hi"})
        trigger.assert_status(409)
        self.assertEqual(len(self.target.payloads), 1)

    async def test_a_handed_off_agent_refuses_relay_messages(self):
        (await self._push()).assert_ok()
        sender = await AgentFactory.new().create(project_id=self.agent.project_id)

        response = await self.post(
            "/api/agent-relay",
            json={"from_agent_id": sender.id, "to_agent_id": self.agent.id, "content": "hi"},
        )

        response.assert_status(409)
        self.assertIn("Cloud box", response.json()["error"])

    async def test_a_push_already_in_flight_is_rejected(self):
        agents_in_flight.add(self.agent.id)
        self.addCleanup(agents_in_flight.discard, self.agent.id)

        response = await self._push()

        response.assert_status(409)
        self.assertEqual(self.target.payloads, [])

    async def test_a_bad_token_leaves_the_agent_untouched(self):
        self.target.ping_status = 401
        before = self._worktree_state()

        response = await self._push()

        response.assert_status(502)
        self.assertIn("token", response.json()["error"])
        self.assertNotIn("tok-123", response.text)
        agent = await Agent.find(self.agent.id)
        self.assertIsNone(agent.handed_off_at)
        self.assertNotEqual(agent.status, "handed_off")
        self.assertEqual(self._worktree_state(), before)
        self.assertEqual(self.target.payloads, [])

    async def test_an_unreachable_target_leaves_the_agent_untouched(self):
        self.target.down = True

        response = await self._push()

        response.assert_status(502)
        self.assertIsNone((await Agent.find(self.agent.id)).handed_off_at)

    async def test_a_target_failure_is_recorded_and_the_retry_reuses_the_key(self):
        self.target.send_status = 500

        failed = await self._push()

        failed.assert_status(502)
        self.assertIn("target exploded", failed.json()["error"])
        self.assertIsNone((await Agent.find(self.agent.id)).handed_off_at)
        record = await Handoff.where("agent_id", self.agent.id).first()
        self.assertEqual(record.status, "failed")

        self.target.send_status = 200
        (await self._push()).assert_ok()

        keys = {payload["handoff_key"] for payload in self.target.payloads}
        self.assertEqual(len(keys), 1)
        self.assertIsNotNone((await Agent.find(self.agent.id)).handed_off_at)

    async def test_only_claude_agents_can_be_pushed(self):
        await Agent.where("id", self.agent.id).update({"provider": "codex"})

        response = await self._push()

        response.assert_status(422)
        self.assertEqual(self.target.payloads, [])

    async def test_an_agent_without_a_conversation_cannot_be_pushed(self):
        transcript_dir(self.repos.config_dir, str(self.repos.worktree)).joinpath(
            f"{SESSION_ID}.jsonl"
        ).unlink()

        response = await self._push()

        response.assert_status(422)

    async def test_index_lists_the_agent_handoffs(self):
        (await self._push()).assert_ok()

        response = await self.get(f"/api/agents/{self.agent.id}/handoffs")

        response.assert_ok()
        self.assertEqual(len(response.json()["data"]), 1)
