from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

HOOK_URL = "/api/agent-hook-events"
TOOL_USE_ID = "toolu_019vgZ7zXZPKBudkEmYGHoxu"

QUESTIONS = [
    {
        "question": "Which database?",
        "header": "DB",
        "options": [
            {"label": "Postgres", "description": "PostgreSQL relational database"},
            {"label": "SQLite", "description": "Embedded file-based database"},
        ],
        "multiSelect": False,
    },
    {
        "question": "Which extras?",
        "header": "Extras",
        "options": [
            {"label": "Redis", "description": "In-memory cache/store"},
            {"label": "Kafka", "description": "Event streaming platform"},
            {"label": "S3", "description": "Object storage"},
        ],
        "multiSelect": True,
    },
]


def pre_tool_use(questions=None, tool_use_id: str | None = TOOL_USE_ID) -> dict:
    return {
        "session_id": "fce853db-08b2-46fb-8e15-179ce44c795e",
        "cwd": "/tmp/somewhere",
        "permission_mode": "bypassPermissions",
        "hook_event_name": "PreToolUse",
        "tool_name": "AskUserQuestion",
        "tool_input": {"questions": QUESTIONS if questions is None else questions},
        "tool_use_id": tool_use_id,
    }


def post_tool_use(answers: dict) -> dict:
    result = {"questions": QUESTIONS, "answers": answers, "annotations": {}}
    return {
        **pre_tool_use(),
        "hook_event_name": "PostToolUse",
        "tool_input": result,
        "tool_response": result,
        "duration_ms": 2,
    }


class TestAgentQuestionController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(project_id=self.project.id, status="running")

    async def _hook(self, payload: dict, agent_id: str | None = None):
        headers = {"X-Keera-Agent-Id": agent_id if agent_id is not None else str(self.agent.id)}
        response = await self.post(HOOK_URL, json=payload, headers=headers)
        response.assert_ok()
        self.assertEqual(response.json(), {})

    async def _questions(self) -> list[dict]:
        response = await self.get(f"/api/agents/{self.agent.id}/questions")
        response.assert_ok()
        return [item["attributes"] for item in response.json()["data"]]

    async def test_stores_every_question_with_options_and_attribution(self):
        await self._hook(pre_tool_use())

        questions = await self._questions()

        self.assertEqual([q["question"] for q in questions], ["Which database?", "Which extras?"])
        first, second = questions
        self.assertEqual(first["header"], "DB")
        self.assertFalse(first["multi_select"])
        self.assertTrue(second["multi_select"])
        self.assertEqual([o["label"] for o in second["options"]], ["Redis", "Kafka", "S3"])
        self.assertEqual(second["options"][2]["description"], "Object storage")
        self.assertEqual(first["agent_id"], self.agent.id)
        self.assertEqual(first["project_id"], self.project.id)
        self.assertEqual(first["session_id"], "fce853db-08b2-46fb-8e15-179ce44c795e")
        self.assertEqual(first["tool_use_id"], TOOL_USE_ID)
        self.assertEqual([q["position"] for q in questions], [0, 1])
        self.assertEqual({q["status"] for q in questions}, {"pending"})

    async def test_still_marks_agent_needs_input(self):
        await self._hook(pre_tool_use())

        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.status, "needs_input")
        self.assertEqual(agent.attention_kind, "question")
        self.assertEqual(agent.attention_prompt, "Which database?")

    async def test_repeated_hook_for_the_same_tool_call_is_stored_once(self):
        await self._hook(pre_tool_use())
        await self._hook(pre_tool_use())

        self.assertEqual(len(await self._questions()), 2)

    async def test_post_tool_use_records_the_answers(self):
        await self._hook(pre_tool_use())

        await self._hook(post_tool_use({"Which database?": "SQLite", "Which extras?": "Redis, S3"}))

        first, second = await self._questions()
        self.assertEqual(first["status"], "answered")
        self.assertEqual(first["answer"], "SQLite")
        self.assertEqual(second["answer"], "Redis, S3")
        self.assertIsNotNone(first["answered_at"])
        agent = await Agent.find(self.agent.id)
        self.assertEqual(agent.status, "running")

    async def test_unattributed_hook_stores_nothing(self):
        await self._hook(
            pre_tool_use(questions=[{**QUESTIONS[0], "question": "Nobody asked?"}]), agent_id=""
        )

        self.assertIsNone(await AgentQuestion.where("question", "Nobody asked?").first())

    async def test_malformed_questions_are_skipped(self):
        await self._hook(pre_tool_use(questions=[{"header": "No text"}, "junk", QUESTIONS[0]]))

        self.assertEqual([q["question"] for q in await self._questions()], ["Which database?"])

    async def test_other_tools_store_nothing(self):
        await self._hook({**pre_tool_use(), "tool_name": "Bash"})

        self.assertEqual(await self._questions(), [])

    async def test_lists_only_the_agents_own_questions(self):
        other = await AgentFactory.new().create(project_id=self.project.id, status="running")
        await self._hook(pre_tool_use(tool_use_id="toolu_other"), agent_id=str(other.id))

        self.assertEqual(await self._questions(), [])

    async def test_unknown_agent_is_not_found(self):
        response = await self.get("/api/agents/999999/questions")

        response.assert_status(404)
