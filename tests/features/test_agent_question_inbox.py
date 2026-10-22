import asyncio

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions import agent_question_answer_action
from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

HOOK_URL = "/api/agent-hook-events"
SESSION_ID = "inbox-session"


class _RecordingTerminal:
    def __init__(self):
        self.writes: list[bytes] = []
        self.sent: list[str] = []

    async def write(self, data: bytes) -> None:
        self.writes.append(data)

    async def send(self, message: str) -> None:
        self.sent.append(message)


class _Terminals:
    def __init__(self, mapping):
        self._mapping = mapping

    def find(self, key):
        return self._mapping.get(key)


class _NoConnections:
    def get(self, key):
        return None

    def all_for_cwd(self, cwd):
        return []


def ask(questions: list[dict], tool_use_id: str) -> dict:
    return {
        "session_id": SESSION_ID,
        "cwd": "/tmp/somewhere",
        "hook_event_name": "PreToolUse",
        "tool_name": "AskUserQuestion",
        "tool_input": {"questions": questions},
        "tool_use_id": tool_use_id,
    }


PATH_QUESTION = {
    "question": "Keep PATH from the login shell?",
    "header": "PATH",
    "options": [
        {"label": "Keep login-shell PATH (Recommended)", "description": "Matches your terminal"},
        {"label": "Rebuild a minimal PATH", "description": "Fast, but brew tools won't resolve"},
    ],
}


PERMISSION_NOTIFICATION = {
    "session_id": SESSION_ID,
    "hook_event_name": "Notification",
    "notification_type": "permission_prompt",
    "message": "Claude needs your permission to use Bash",
}


def permission_request(command: str) -> dict:
    return {
        "session_id": SESSION_ID,
        "cwd": "/tmp/somewhere",
        "hook_event_name": "PermissionRequest",
        "tool_name": "Bash",
        "tool_input": {"command": command, "description": "Clean the build"},
    }


class TestAgentQuestionInbox(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        container = app()
        self._original_terminals = container.make("terminal")
        self._original_connections = container.make("connections")
        self._original_delay = agent_question_answer_action.DIALOG_CLOSE_DELAY
        agent_question_answer_action.DIALOG_CLOSE_DELAY = 0
        self.terminal = _RecordingTerminal()
        container.bind("terminal", _Terminals({SESSION_ID: self.terminal}))
        container.bind("connections", _NoConnections())

        self.project = await ProjectFactory.new().create(name="Inbox Project")
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, status="running", session_id=SESSION_ID, name="Env Fixer"
        )

    async def asyncTearDown(self):
        container = app()
        container.bind("terminal", self._original_terminals)
        container.bind("connections", self._original_connections)
        agent_question_answer_action.DIALOG_CLOSE_DELAY = self._original_delay
        await super().asyncTearDown()

    async def _hook(self, payload: dict, agent: Agent | None = None):
        headers = {"X-Keera-Agent-Id": str((agent or self.agent).id)}
        response = await self.post(HOOK_URL, json=payload, headers=headers)
        response.assert_ok()

    async def _inbox(self, status: str = "pending") -> list[dict]:
        response = await self.get(f"/api/agent-questions?status={status}")
        response.assert_ok()
        items = [{**item["attributes"], "id": int(item["id"])} for item in response.json()["data"]]
        return [item for item in items if item["agent_id"] == self.agent.id]

    async def _answer(self, question_id: int, payload: dict):
        return await self.post(f"/api/agent-questions/{question_id}/answer", json=payload)

    async def test_lists_pending_questions_with_agent_and_project_context(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_1"))

        [item] = await self._inbox()

        self.assertEqual(item["kind"], "question")
        self.assertEqual(item["agent_name"], "Env Fixer")
        self.assertEqual(item["project_name"], "Inbox Project")
        self.assertEqual(item["project_slug"], self.project.slug)
        first, second = item["options"]
        self.assertEqual(first["label"], "Keep login-shell PATH")
        self.assertTrue(first["recommended"])
        self.assertFalse(second["recommended"])

    async def test_answering_delivers_to_the_terminal_and_moves_the_item_to_answered(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_2"))
        [item] = await self._inbox()

        response = await self._answer(
            item["id"], {"choices": ["Keep login-shell PATH"], "text": "and keep pyenv"}
        )

        response.assert_ok()
        self.assertEqual(response.json()["data"]["attributes"]["status"], "answered")
        self.assertEqual(self.terminal.writes, [b"\x1b"])
        self.assertEqual(
            self.terminal.sent,
            [
                'My answer to your question "Keep PATH from the login shell?": '
                "Keep login-shell PATH — and keep pyenv"
            ],
        )
        self.assertEqual(await self._inbox(), [])
        [answered] = await self._inbox("answered")
        self.assertEqual(answered["answer"], "Keep login-shell PATH — and keep pyenv")
        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.status, "running")
        self.assertIsNone(agent.attention_kind)

    async def test_free_text_only_answer_is_accepted(self):
        await self._hook(ask([{**PATH_QUESTION, "options": []}], "toolu_inbox_3"))
        [item] = await self._inbox()

        response = await self._answer(item["id"], {"text": "Use the venv only"})

        response.assert_ok()
        self.assertEqual(
            self.terminal.sent,
            ['My answer to your question "Keep PATH from the login shell?": Use the venv only'],
        )

    async def test_a_multi_question_call_is_delivered_once_every_question_is_answered(self):
        second = {**PATH_QUESTION, "question": "Also pin Python?"}
        await self._hook(ask([PATH_QUESTION, second], "toolu_inbox_4"))
        first_item, second_item = await self._inbox()

        (await self._answer(first_item["id"], {"choices": ["Rebuild a minimal PATH"]})).assert_ok()

        self.assertEqual(self.terminal.sent, [])
        self.assertEqual((await Agent.find(self.agent.id)).status, "needs_input")

        (await self._answer(second_item["id"], {"text": "Yes, 3.13"})).assert_ok()

        self.assertEqual(
            self.terminal.sent,
            [
                "My answers to your questions:\n"
                '- "Keep PATH from the login shell?": Rebuild a minimal PATH\n'
                '- "Also pin Python?": Yes, 3.13'
            ],
        )

    async def test_an_empty_answer_is_rejected(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_5"))
        [item] = await self._inbox()

        response = await self._answer(item["id"], {"choices": [], "text": "  "})

        response.assert_status(422)
        self.assertIn("choices", response.json()["errors"])
        self.assertEqual(self.terminal.sent, [])

    async def test_a_question_never_creates_a_permission_item(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_12"))
        await self._hook({**permission_request("x"), "tool_name": "AskUserQuestion", "tool_input": {"questions": [PATH_QUESTION]}})
        await self._hook({**PERMISSION_NOTIFICATION, "message": "Claude needs your permission to use AskUserQuestion"})
        await self._hook(PERMISSION_NOTIFICATION)

        items = await self._inbox()

        self.assertEqual([item["kind"] for item in items], ["question"])
        self.assertEqual((await Agent.find(self.agent.id)).attention_kind, "question")

    async def test_a_bash_permission_still_records_its_command_without_a_pending_question(self):
        await self._hook(PERMISSION_NOTIFICATION)
        await self._hook(permission_request("rm -rf build"))

        [item] = await self._inbox()

        self.assertEqual(item["kind"], "permission")
        self.assertEqual(item["detail"], "rm -rf build")

    async def test_answering_in_the_terminal_settles_every_pending_item(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_13"))
        await self._hook(permission_request("rm -rf build"))

        await self._hook(
            {
                "session_id": SESSION_ID,
                "hook_event_name": "PostToolUse",
                "tool_name": "AskUserQuestion",
                "tool_use_id": "toolu_inbox_13",
                "tool_response": {"answers": {PATH_QUESTION["question"]: "Keep login-shell PATH"}},
            }
        )

        self.assertEqual(await self._inbox(), [])
        answers = {item["kind"]: item["answer"] for item in await self._inbox("answered")}
        self.assertEqual(answers["question"], "Keep login-shell PATH")

    async def test_stop_settles_every_pending_item(self):
        await self._hook(permission_request("rm -rf build"))

        response = await self.post(
            "/api/claude-stopped",
            json={"session_id": SESSION_ID, "cwd": "/tmp/somewhere", "hook_event_name": "Stop"},
            headers={"X-Keera-Agent-Id": str(self.agent.id)},
        )

        response.assert_ok()
        self.assertEqual(await self._inbox(), [])

    async def test_answering_a_question_settles_leftover_items(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_14"))
        [question] = await self._inbox()
        leftover = await AgentQuestion.create(
            {"agent_id": self.agent.id, "project_id": self.project.id, "kind": "permission",
             "question": "Allow Bash?", "options": [], "multi_select": False, "status": "pending"}
        )

        (await self._answer(question["id"], {"text": "keep it"})).assert_ok()

        self.assertEqual((await AgentQuestion.find(leftover.id)).status, "answered")

    async def test_answering_twice_is_a_conflict(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_6"))
        [item] = await self._inbox()
        (await self._answer(item["id"], {"text": "first"})).assert_ok()

        response = await self._answer(item["id"], {"text": "second"})

        response.assert_status(409)
        self.assertEqual(response.json()["error"], "This question has already been answered.")

    async def test_answering_without_a_running_terminal_is_a_conflict(self):
        await Agent.where("id", self.agent.id).update({"session_id": "gone"})
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_7"))
        [item] = await self._inbox()

        response = await self._answer(item["id"], {"text": "hello"})

        response.assert_status(409)
        self.assertEqual((await AgentQuestion.find(item["id"])).status, "pending")

    async def test_unknown_question_is_not_found(self):
        response = await self._answer(999999, {"text": "hello"})

        response.assert_status(404)

    async def test_permission_prompt_is_listed_and_allow_presses_enter(self):
        await self._hook(
            {
                "session_id": SESSION_ID,
                "hook_event_name": "Notification",
                "notification_type": "permission_prompt",
                "message": "Claude needs your permission to use Bash",
            }
        )
        [item] = await self._inbox()
        self.assertEqual(item["kind"], "permission")
        self.assertEqual([o["label"] for o in item["options"]], ["Allow", "Deny"])

        (await self._answer(item["id"], {"choices": ["Allow"]})).assert_ok()

        self.assertEqual(self.terminal.writes, [b"\r"])
        self.assertEqual(self.terminal.sent, [])

    async def test_deny_with_a_note_escapes_and_sends_the_note(self):
        await self._hook(
            {
                "session_id": SESSION_ID,
                "hook_event_name": "Notification",
                "notification_type": "permission_prompt",
                "message": "Claude needs your permission to use Bash",
            }
        )
        [item] = await self._inbox()

        (await self._answer(item["id"], {"choices": ["Deny"], "text": "Never force push"})).assert_ok()

        self.assertEqual(self.terminal.writes, [b"\x1b"])
        self.assertEqual(self.terminal.sent, ["Never force push"])

    async def test_a_permission_answered_in_the_terminal_leaves_pending(self):
        await self._hook(
            {
                "session_id": SESSION_ID,
                "hook_event_name": "Notification",
                "notification_type": "permission_prompt",
                "message": "Claude needs your permission to use Bash",
            }
        )

        await self._hook({"session_id": SESSION_ID, "hook_event_name": "PostToolUse", "tool_name": "Bash"})

        self.assertEqual(await self._inbox(), [])

    async def test_a_prompt_typed_in_the_terminal_settles_pending_questions(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_8"))

        await self._hook({"session_id": SESSION_ID, "hook_event_name": "UserPromptSubmit"})

        self.assertEqual(await self._inbox(), [])

    async def test_concurrent_answers_to_one_question_deliver_once(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_9"))
        [item] = await self._inbox()

        responses = await asyncio.gather(
            self._answer(item["id"], {"text": "first"}),
            self._answer(item["id"], {"text": "second"}),
        )

        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(self.terminal.writes, [b"\x1b"])
        self.assertEqual(len(self.terminal.sent), 1)

    async def test_concurrent_answers_to_sibling_questions_deliver_the_call_once(self):
        second = {**PATH_QUESTION, "question": "Also pin Python?"}
        await self._hook(ask([PATH_QUESTION, second], "toolu_inbox_10"))
        first_item, second_item = await self._inbox()

        responses = await asyncio.gather(
            self._answer(first_item["id"], {"text": "keep it"}),
            self._answer(second_item["id"], {"text": "3.13"}),
        )

        self.assertEqual([response.status_code for response in responses], [200, 200])
        self.assertEqual(self.terminal.writes, [b"\x1b"])
        self.assertEqual(len(self.terminal.sent), 1)
        self.assertIn('"Also pin Python?": 3.13', self.terminal.sent[0])

    async def test_answering_an_agent_that_is_no_longer_waiting_is_a_conflict(self):
        await self._hook(ask([PATH_QUESTION], "toolu_inbox_11"))
        [item] = await self._inbox()
        await Agent.where("id", self.agent.id).update({"status": "running"})

        response = await self._answer(item["id"], {"text": "too late"})

        response.assert_status(409)
        self.assertEqual(response.json()["error"], "This was already answered in the terminal, so the agent is no longer waiting.")
        self.assertEqual(self.terminal.writes, [])
        self.assertEqual(await self._inbox(), [])

    async def test_a_permission_needs_allow_or_deny(self):
        await self._hook(PERMISSION_NOTIFICATION)
        [item] = await self._inbox()

        response = await self._answer(item["id"], {"text": "go ahead"})

        response.assert_status(422)
        self.assertEqual(response.json()["error"], "Choose Allow or Deny.")
        self.assertEqual(self.terminal.writes, [])
        self.assertEqual((await AgentQuestion.find(item["id"])).status, "pending")

    async def test_a_permission_request_shows_the_tool_and_command(self):
        await self._hook(permission_request("rm -rf build"))
        await self._hook(PERMISSION_NOTIFICATION)

        [item] = await self._inbox()

        self.assertEqual(item["question"], "Allow Bash?")
        self.assertEqual(item["header"], "Bash")
        self.assertEqual(item["detail"], "rm -rf build")
        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.status, "needs_input")
        self.assertEqual(agent.attention_kind, "permission")

    async def test_a_new_permission_prompt_replaces_the_stale_one(self):
        await self._hook(permission_request("rm -rf build"))
        [stale] = await self._inbox()

        await self._hook(permission_request("make deploy"))

        [item] = await self._inbox()
        self.assertEqual(item["id"], stale["id"])
        self.assertEqual(item["detail"], "make deploy")

    async def test_a_new_permission_notification_replaces_a_stale_generic_one(self):
        await self._hook(PERMISSION_NOTIFICATION)
        await self._hook({**PERMISSION_NOTIFICATION, "message": "Claude needs your permission to use Write"})

        [item] = await self._inbox()

        self.assertEqual(item["question"], "Claude needs your permission to use Write")

    async def test_inbox_page_renders(self):
        response = await self.get("/inbox?item=3", headers={"X-Inertia": "true"})

        response.assert_ok()
        self.assertEqual(response.json()["component"], "Inbox")
        self.assertEqual(response.json()["props"]["selected_question_id"], 3)
