"""Unit tests for notify_agent_status's WebSocket payload."""

import json
import os

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_status_action import notify_agent_status
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


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


class TestNotifyAgentStatus(TestCase, DatabaseTransaction):
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

    async def test_payload_includes_attention_kind_when_present(self):
        await notify_agent_status(self.agent, "needs_input", "question")

        self.assertEqual(len(self.bridge.sent), 1)
        payload = json.loads(self.bridge.sent[0])
        self.assertEqual(
            payload,
            {
                "type": "agent_status",
                "agent_id": self.agent.id,
                "status": "needs_input",
                "attention_kind": "question",
            },
        )

    async def test_payload_has_null_attention_kind_when_absent(self):
        await notify_agent_status(self.agent, "running")

        payload = json.loads(self.bridge.sent[0])
        self.assertIsNone(payload["attention_kind"])
