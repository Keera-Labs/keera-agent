import json
import os

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.requests.agent_hook_event_request import ATTENTION_PROMPT_LENGTH
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

URL = "/api/agent-hook-events"


def ask_question(question: str) -> dict:
    return {
        "hook_event_name": "PreToolUse",
        "cwd": "/tmp/somewhere",
        "tool_name": "AskUserQuestion",
        "tool_input": {"questions": [{"question": question, "header": "Q", "options": []}]},
    }


def permission_prompt(message: str = "Claude needs your permission to use Bash") -> dict:
    return {
        "hook_event_name": "Notification",
        "cwd": "/tmp/somewhere",
        "notification_type": "permission_prompt",
        "message": message,
    }


def elicitation_dialog(message: str = "Pick a deployment target") -> dict:
    return {
        "hook_event_name": "Notification",
        "cwd": "/tmp/somewhere",
        "notification_type": "elicitation_dialog",
        "message": message,
    }


class TestAgentHookEventController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(project_id=self.project.id, status="running")

    def _headers(self, agent_id=None) -> dict:
        return {"X-Keera-Agent-Id": str(agent_id or self.agent.id)}

    async def _post(self, payload: dict, headers: dict | None = None) -> Agent:
        response = await self.post(URL, json=payload, headers=headers or self._headers())
        response.assert_ok()
        self.assertEqual(response.json(), {})
        return await Agent.find(self.agent.id)

    async def test_ask_user_question_marks_agent_needs_input_with_question(self):
        agent = await self._post(ask_question("Which database should we use?"))

        self.assertEqual(agent.status, "needs_input")
        self.assertEqual(agent.attention_kind, "question")
        self.assertEqual(agent.attention_prompt, "Which database should we use?")

    async def test_permission_prompt_marks_agent_needs_input(self):
        agent = await self._post(permission_prompt())

        self.assertEqual(agent.status, "needs_input")
        self.assertEqual(agent.attention_kind, "permission")
        self.assertEqual(agent.attention_prompt, "Claude needs your permission to use Bash")

    async def test_elicitation_dialog_marks_agent_needs_input_with_question(self):
        agent = await self._post(elicitation_dialog())

        self.assertEqual(agent.status, "needs_input")
        self.assertEqual(agent.attention_kind, "question")
        self.assertEqual(agent.attention_prompt, "Pick a deployment target")

    async def test_idle_prompt_notification_is_ignored(self):
        agent = await self._post({**permission_prompt(), "notification_type": "idle_prompt"})

        self.assertEqual(agent.status, "running")
        self.assertIsNone(agent.attention_kind)

    async def test_other_tools_do_not_block(self):
        agent = await self._post({**ask_question("x"), "tool_name": "Bash"})

        self.assertEqual(agent.status, "running")

    async def test_long_prompt_is_truncated(self):
        agent = await self._post(ask_question("why " * 400))

        self.assertEqual(len(agent.attention_prompt), ATTENTION_PROMPT_LENGTH)
        self.assertTrue(agent.attention_prompt.endswith("…"))

    async def test_post_tool_use_clears_needs_input(self):
        await self._post(ask_question("Proceed?"))

        agent = await self._post({"hook_event_name": "PostToolUse", "tool_name": "AskUserQuestion"})

        self.assertEqual(agent.status, "running")
        self.assertIsNone(agent.attention_kind)
        self.assertIsNone(agent.attention_prompt)

    async def test_post_tool_use_restores_a_waiting_agent_to_running(self):
        """A tool call proves the agent is working, so a stale `waiting` self-heals."""
        await Agent.where("id", self.agent.id).update({"status": "waiting"})

        agent = await self._post({"hook_event_name": "PostToolUse", "tool_name": "Bash"})

        self.assertEqual(agent.status, "running")

    async def test_unattributed_post_tool_use_does_not_touch_agents(self):
        await Agent.where("id", self.agent.id).update({"status": "waiting"})

        agent = await self._post(
            {"hook_event_name": "PostToolUse", "tool_name": "Bash"},
            headers={"X-Keera-Agent-Id": "$KEERA_AGENT_ID"},
        )

        self.assertEqual(agent.status, "waiting")

    async def test_user_prompt_submit_marks_agent_running(self):
        await Agent.where("id", self.agent.id).update({"status": "waiting"})

        agent = await self._post({"hook_event_name": "UserPromptSubmit", "prompt": "go"})

        self.assertEqual(agent.status, "running")

    async def test_attributes_by_agent_worktree_cwd_without_header(self):
        cwd = f"/work/repo/.claude/worktrees/agent-{self.agent.id}"

        agent = await self._post({**ask_question("Ship it?"), "cwd": cwd}, headers={})

        self.assertEqual(agent.status, "needs_input")

    async def test_unattributed_event_is_a_noop(self):
        agent = await self._post(
            ask_question("Ship it?"), headers={"X-Keera-Agent-Id": "$KEERA_AGENT_ID"}
        )

        self.assertEqual(agent.status, "running")

    async def test_unknown_agent_is_a_noop(self):
        response = await self.post(URL, json=ask_question("?"), headers=self._headers(999_999))
        response.assert_ok()

    async def test_only_the_attributed_agent_changes(self):
        sibling = await AgentFactory.new().create(project_id=self.project.id, status="running")

        await self._post(permission_prompt())

        self.assertEqual((await Agent.find(sibling.id)).status, "running")


class _RecordingBridge:
    def __init__(self):
        self.sent: list[str] = []

    async def write(self, message: str) -> None:
        self.sent.append(message)


class _FakeConnections:
    def __init__(self, cwd: str, bridge: _RecordingBridge):
        self._cwd = cwd
        self._bridge = bridge

    def all_for_cwd(self, cwd: str):
        return [self._bridge] if cwd == self._cwd else []


class TestAgentHookEventControllerPushPayload(TestCase, DatabaseTransaction):
    """The frontend chimes on `agent_status` pushes whose `attention_kind` is `question`,
    so the pushed payload must carry the mapped kind, not just the DB row."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(project_id=self.project.id, status="running")
        self.bridge = _RecordingBridge()
        container = app()
        self._orig_connections = container.make("connections")
        container.bind(
            "connections",
            _FakeConnections(os.path.expanduser(self.project.path), self.bridge),
        )

    async def asyncTearDown(self):
        app().bind("connections", self._orig_connections)
        await super().asyncTearDown()

    async def _post(self, payload: dict) -> dict:
        response = await self.post(
            URL, json=payload, headers={"X-Keera-Agent-Id": str(self.agent.id)}
        )
        response.assert_ok()
        self.assertEqual(len(self.bridge.sent), 1)
        return json.loads(self.bridge.sent[0])

    async def test_ask_user_question_pushes_question_attention_kind(self):
        pushed = await self._post(ask_question("Which database?"))

        self.assertEqual(
            pushed,
            {
                "type": "agent_status",
                "agent_id": self.agent.id,
                "status": "needs_input",
                "attention_kind": "question",
            },
        )

    async def test_elicitation_dialog_pushes_question_attention_kind(self):
        pushed = await self._post(elicitation_dialog())

        self.assertEqual(pushed["attention_kind"], "question")

    async def test_permission_prompt_pushes_permission_attention_kind(self):
        pushed = await self._post(permission_prompt())

        self.assertEqual(pushed["attention_kind"], "permission")

    async def test_resuming_work_pushes_null_attention_kind(self):
        await self._post(ask_question("Proceed?"))
        self.bridge.sent.clear()

        pushed = await self._post(
            {"hook_event_name": "PostToolUse", "tool_name": "AskUserQuestion"}
        )

        self.assertEqual(
            pushed,
            {
                "type": "agent_status",
                "agent_id": self.agent.id,
                "status": "running",
                "attention_kind": None,
            },
        )
