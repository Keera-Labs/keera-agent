import re

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction
from pydantic import ValidationError

from app.constant.agent_types import DEFAULT_AGENT_TYPE, AgentType
from app.mcp.tools import SpawnAgentInput, SpawnAgentTool
from app.models.Agent import Agent
from app.utils.system_prompts import default_system_prompt
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


def _spawn_input(agent_type: str) -> dict:
    return {
        "project_path": "/tmp/project",
        "name": "Engineer",
        "agent_type": agent_type,
        "complexity": "medium",
    }


class TestSpawnAgentInputAgentType(TestCase):
    async def test_accepts_every_agent_type(self):
        for agent_type in AgentType:
            with self.subTest(agent_type=agent_type.value):
                self.assertEqual(
                    SpawnAgentInput(**_spawn_input(agent_type.value)).agent_type, agent_type.value
                )

    async def test_rejects_unknown_agent_type(self):
        for agent_type in ("custom", "qa_browser"):
            with self.subTest(agent_type=agent_type), self.assertRaises(ValidationError):
                SpawnAgentInput(**_spawn_input(agent_type))

    async def test_schema_pattern_comes_from_enum(self):
        schema = SpawnAgentInput.model_json_schema()
        self.assertEqual(schema["properties"]["agent_type"]["pattern"], AgentType.pattern())


class TestPmPromptAgentTypes(TestCase):
    async def test_lists_every_agent_type_and_no_custom(self):
        prompt = default_system_prompt("pm")
        for agent_type in AgentType:
            self.assertIn(f"- `{agent_type.value}` — {agent_type.role}\n", prompt)
        self.assertNotIn("`custom`", prompt)


class TestSpawnAgentToolAgentTypes(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def test_spawns_every_agent_type(self):
        for agent_type in AgentType:
            with self.subTest(agent_type=agent_type.value):
                response = await SpawnAgentTool().handle(
                    {
                        "project_path": self.project.path,
                        "name": f"{agent_type.value} agent",
                        "agent_type": agent_type.value,
                        "complexity": "medium",
                    }
                )
                agent_id = int(re.search(r"ID:\s*(\d+)", response.to_content()[0]["text"]).group(1))
                self.assertEqual((await Agent.find(agent_id)).agent_type, agent_type.value)


class TestAgentTypeColumnDefault(TestCase, DatabaseTransaction):
    async def test_defaults_to_software_engineer(self):
        project = await ProjectFactory.new().create()
        created = await Agent.create({"project_id": project.id, "name": "Untyped"})

        agent = await Agent.find(created.id)

        self.assertEqual(agent.agent_type, DEFAULT_AGENT_TYPE.value)
