import asyncio
import json
from unittest import mock

import httpx
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_handoff_push_action import AgentHandoffPushAction
from app.actions.agent_status_action import utc_now
from app.models.Agent import Agent
from app.models.Handoff import Handoff
from app.models.Server import Server
from app.services.handoff.client import HandoffClient
from app.services.handoff.transcript import transcript_dir
from databases.factories.agent_factory import AgentFactory
from tests.features.handoff_repos import SESSION_ID, HandoffRepos
from tests.test_case import TestCase


class FakeTarget:
    def __init__(self):
        self.preflight_status = 200
        self.send_status = 200
        self.send_body: bytes | None = None
        self.down = False
        self.send_delay = 0.0
        self.preflights: list[dict] = []
        self.payloads: list[dict] = []
        self.authorizations: list[str] = []

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        self.authorizations.append(request.headers.get("authorization"))
        body = json.loads(request.content)
        if request.url.path == "/api/handoffs/preflight":
            self.preflights.append(body)
            if self.preflight_status != 200:
                return httpx.Response(self.preflight_status, json={"error": "no such project"})
            return httpx.Response(200, json={"data": {"project_id": 1, "model": "m"}})
        self.payloads.append(body)
        await asyncio.sleep(self.send_delay)
        if self.send_body is not None:
            return httpx.Response(200, content=self.send_body)
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
            git("status", "--porcelain", "--ignored", cwd=self.repos.worktree),
        )

    def _remote_handoff_branches(self) -> list[str]:
        refs = self.repos.repo.git("for-each-ref", "--format=%(refname)", cwd=self.repos.remote)
        return [ref for ref in refs.split() if ref.startswith("refs/heads/handoff/")]

    def _live(self, was_live: bool = True):
        stop = mock.patch.object(
            AgentHandoffPushAction, "_stop", new=mock.AsyncMock(return_value=was_live)
        )
        spawn = mock.patch(
            "app.controllers.agent_trigger_controller._spawn_headless_agent",
            new_callable=mock.AsyncMock,
        )
        stop.start()
        self.addCleanup(stop.stop)
        spawned = spawn.start()
        self.addCleanup(spawn.stop)
        return spawned

    async def test_push_sends_work_transcript_and_metadata_then_marks_the_agent(self):
        before = self._worktree_state()

        response = await self._push()

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["status"], "completed")
        self.assertEqual(attributes["remote_agent_id"], 77)
        self.assertEqual(self.target.authorizations, ["Bearer tok-123", "Bearer tok-123"])
        self.assertEqual(
            self.target.preflights[0]["agent"],
            {"provider": "claude", "model": "claude-sonnet-5", "complexity": "medium"},
        )

        payload = self.target.payloads[0]
        self.assertEqual(payload["agent"]["name"], "Mover")
        self.assertEqual(payload["agent"]["source_agent_id"], self.agent.id)
        self.assertFalse(payload["agent"]["system_prompt_is_default"])
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
        self.assertIsNone(agent.handoff_claim)
        self.assertIsNone(agent.deleted_at)

    async def test_a_default_system_prompt_is_flagged_for_regeneration(self):
        from app.utils.system_prompts import default_system_prompt

        await Agent.where("id", self.agent.id).update(
            {"system_prompt": default_system_prompt("software_engineer")}
        )

        (await self._push()).assert_ok()

        self.assertTrue(self.target.payloads[0]["agent"]["system_prompt_is_default"])

    async def test_untracked_secrets_refuse_the_push_before_anything_happens(self):
        secrets = [
            ".envrc",
            "prod.env",
            ".ENV",
            "id_ecdsa",
            "id_dsa",
            "certs/client.p12",
            "keys/release.jks",
            ".npmrc",
            ".pypirc",
            ".netrc",
            ".git-credentials",
            ".aws/credentials",
            "credentials.json",
            "gcp-key.json",
            "infra/terraform.tfvars",
        ]
        for path in secrets:
            target = self.repos.worktree / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("secret\n")
        (self.repos.worktree / ".env.example").write_text("API_KEY=\n")
        spawned = self._live()
        before = self._worktree_state()

        response = await self._push()

        response.assert_status(422)
        error = response.json()["error"]
        for path in secrets:
            self.assertIn(path, error)
        self.assertNotIn(".env.example", error)
        self.assertEqual(self.target.preflights, [])
        self.assertEqual(self.target.payloads, [])
        self.assertEqual(self._remote_handoff_branches(), [])
        self.assertEqual(self._worktree_state(), before)
        AgentHandoffPushAction._stop.assert_not_called()
        spawned.assert_not_called()
        self.assertIsNone((await Agent.find(self.agent.id)).handoff_claim)

    async def test_a_modified_tracked_secret_also_refuses_the_push(self):
        self.repos.repo.git("add", "-f", ".env", cwd=self.repos.worktree)
        self.repos.repo.git("commit", "-q", "-m", "oops", cwd=self.repos.worktree)
        (self.repos.worktree / ".env").write_text("API_KEY=rotated\n")

        response = await self._push()

        response.assert_status(422)
        self.assertIn(".env", response.json()["error"])

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

    async def test_a_live_claim_in_the_database_rejects_another_push(self):
        await Agent.where("id", self.agent.id).update(
            {"handoff_claim": "someone-else", "handoff_claimed_at": utc_now()}
        )

        response = await self._push()

        response.assert_status(409)
        self.assertEqual(self.target.preflights, [])
        trigger = await self.post(f"/api/agents/{self.agent.id}/trigger", json={"message": "hi"})
        trigger.assert_status(409)

    async def test_a_stale_claim_is_taken_over(self):
        await Agent.where("id", self.agent.id).update(
            {"handoff_claim": "crashed", "handoff_claimed_at": "2000-01-01 00:00:00"}
        )

        (await self._push()).assert_ok()

    async def test_concurrent_pushes_hand_off_once(self):
        self.target.send_delay = 0.2

        first, second = await asyncio.gather(self._push(), self._push())

        self.assertEqual(sorted([first.status_code, second.status_code]), [200, 409])
        self.assertEqual(len(self.target.payloads), 1)

    async def test_a_bad_token_leaves_the_agent_untouched(self):
        self.target.preflight_status = 401
        spawned = self._live()
        before = self._worktree_state()

        response = await self._push()

        response.assert_status(502)
        self.assertIn("token", response.json()["error"])
        self.assertNotIn("tok-123", response.text)
        agent = await Agent.find(self.agent.id)
        self.assertIsNone(agent.handed_off_at)
        self.assertIsNone(agent.handoff_claim)
        self.assertEqual(self._worktree_state(), before)
        self.assertEqual(self.target.payloads, [])
        AgentHandoffPushAction._stop.assert_not_called()
        spawned.assert_not_called()

    async def test_a_target_preflight_rejection_stops_nothing(self):
        self.target.preflight_status = 422
        self._live()

        response = await self._push()

        response.assert_status(502)
        self.assertIn("no such project", response.json()["error"])
        AgentHandoffPushAction._stop.assert_not_called()
        self.assertEqual(await Handoff.where("agent_id", self.agent.id).count(), 0)

    async def test_an_unreachable_target_leaves_the_agent_untouched(self):
        self.target.down = True

        response = await self._push()

        response.assert_status(502)
        self.assertIsNone((await Agent.find(self.agent.id)).handed_off_at)

    async def test_a_target_4xx_restores_the_source_and_deletes_the_branch(self):
        self.target.send_status = 409
        spawned = self._live()
        before = self._worktree_state()

        response = await self._push()

        response.assert_status(502)
        self.assertIn("target exploded", response.json()["error"])
        agent = await Agent.find(self.agent.id)
        self.assertIsNone(agent.handed_off_at)
        self.assertIsNone(agent.handoff_claim)
        self.assertNotEqual(agent.status, "handed_off")
        self.assertEqual(self._worktree_state(), before)
        self.assertEqual(self._remote_handoff_branches(), [])
        record = await Handoff.where("agent_id", self.agent.id).first()
        self.assertEqual(record.status, "failed")
        self.assertNotIn("may have accepted", record.error)
        await asyncio.sleep(0)
        spawned.assert_called_once()
        self.assertIn("failed", spawned.call_args.args[3])
        self.assertEqual(spawned.call_args.args[0].id, self.agent.id)

    async def test_an_uncertain_target_failure_keeps_the_source_stopped(self):
        self.target.send_status = 503
        spawned = self._live()

        failed = await self._push()

        failed.assert_status(502)
        record = await Handoff.where("agent_id", self.agent.id).first()
        self.assertEqual(record.status, "failed")
        self.assertIn("may have accepted", record.error)
        self.assertEqual(self._remote_handoff_branches(), [])
        await asyncio.sleep(0)
        spawned.assert_not_called()

        self.target.send_status = 200
        (await self._push()).assert_ok()
        keys = {payload["handoff_key"] for payload in self.target.payloads}
        self.assertEqual(len(keys), 1)
        self.assertIsNotNone((await Agent.find(self.agent.id)).handed_off_at)

    async def test_an_invalid_target_response_is_a_handled_failure(self):
        self.target.send_body = b"<html>proxy error</html>"

        response = await self._push()

        response.assert_status(502)
        self.assertIn("invalid response", response.json()["error"])
        record = await Handoff.where("agent_id", self.agent.id).first()
        self.assertEqual(record.status, "failed")

    async def test_an_unexpected_error_is_recorded_and_the_claim_released(self):
        def explode(*args, **kwargs):
            raise OSError("disk full")

        with mock.patch("app.services.handoff.transcript.export_session", side_effect=explode):
            with self.assertRaises(OSError):
                await AgentHandoffPushAction(
                    self.agent.id,
                    self.server.id,
                    client=self.target.client("http://target.test", "y"),
                ).execute()

        record = await Handoff.where("agent_id", self.agent.id).first()
        self.assertEqual(record.status, "failed")
        self.assertEqual(record.error, "Unexpected handoff failure.")
        agent = await Agent.find(self.agent.id)
        self.assertIsNone(agent.handoff_claim)
        self.assertIsNone(agent.handed_off_at)
        self.assertEqual(self._remote_handoff_branches(), [])

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
