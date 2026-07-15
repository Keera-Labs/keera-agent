"""
Feature tests for agent_dispatch_controller.spawn.

Regression guard for the bug where a freshly spawned agent silently dropped its
first task message (no ACK): spawn() scheduled _spawn_headless_agent with an
extra stale positional argument, so the fire-and-forget task raised TypeError
before it could ever inject the message.
"""

import tempfile
from unittest.mock import AsyncMock, patch

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestAgentDispatchSpawn(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmpdir = tempfile.mkdtemp()
        self.project = await ProjectFactory.new().create(path=self._tmpdir)

    def _payload(self, **overrides) -> dict:
        payload = {
            "name": "DispatchBot",
            "agent_type": "software_engineer",
            "complexity": "easy",
        }
        payload.update(overrides)
        return payload

    async def test_spawn_with_message_invokes_headless_spawn_with_correct_arity(self):
        """spawn() must call _spawn_headless_agent(agent, project, cwd, message) —
        exactly four positional args. An extra arg makes the create_task coroutine
        raise TypeError and the first message is silently dropped."""
        spy = AsyncMock()
        with patch(
            "app.controllers.agent_trigger_controller._spawn_headless_agent",
            spy,
        ):
            response = await self.post(
                f"/api/projects/{self.project.id}/agents/spawn",
                json=self._payload(message="Implement the feature"),
            )
        response.assert_ok()

        spy.assert_called_once()
        args = spy.call_args.args
        self.assertEqual(
            len(args),
            4,
            f"_spawn_headless_agent expected 4 positional args, got {len(args)}: {args!r}",
        )
        # The initial message must be the 4th argument, not swallowed by a stray one.
        self.assertEqual(args[3], "Implement the feature")

    async def test_spawn_without_message_does_not_start_agent(self):
        """No initial message → no headless spawn scheduled."""
        spy = AsyncMock()
        with patch(
            "app.controllers.agent_trigger_controller._spawn_headless_agent",
            spy,
        ):
            response = await self.post(
                f"/api/projects/{self.project.id}/agents/spawn",
                json=self._payload(),
            )
        response.assert_ok()
        spy.assert_not_called()
