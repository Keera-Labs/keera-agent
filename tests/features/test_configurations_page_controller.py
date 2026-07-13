"""
Feature tests for configurations_page_controller.

The Configurations screen is a backend-routed Inertia page that delivers the
project's commands as server props, so the panel never depends on a client fetch
that can fail (the failure mode behind tasks #862 and #906).
"""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Command import Command
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

INERTIA_HEADERS = {"X-Inertia": "true", "X-Inertia-Version": ""}


class TestConfigurationsPageController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _create_command(self, **overrides) -> Command:
        return await Command.create(
            {
                "project_id": self.project.id,
                "label": "Dev Server",
                "command": "npm run dev",
                "description": "",
                "category": "General",
                "shortcut": "",
                "status": "stopped",
                **overrides,
            }
        )

    async def test_page_renders_project_and_commands_props(self):
        command = await self._create_command()

        response = await self.get(
            f"/{self.project.slug}/configurations", headers=INERTIA_HEADERS
        )

        response.assert_ok().assert_json(
            lambda j: j.has(
                "props",
                lambda p: p.where("project", self.project.slug)
                .where("project_id", self.project.id)
                .has(
                    "commands",
                    1,
                    lambda cs: cs.first(
                        lambda c: c.where("id", command.id)
                        .where("label", "Dev Server")
                        .where("command", "npm run dev")
                        .where("status", "stopped")
                        .etc()
                    ),
                )
                .etc(),
            ).etc()
        )

    async def test_page_with_no_commands_returns_empty_list(self):
        response = await self.get(
            f"/{self.project.slug}/configurations", headers=INERTIA_HEADERS
        )
        response.assert_ok().assert_json(
            lambda j: j.has("props", lambda p: p.where("commands", []).etc()).etc()
        )

    async def test_page_reconciles_stale_running_command_to_stopped(self):
        """A command left 'running' with no live process is corrected on load."""
        command = await self._create_command(status="running", pid=424242)

        response = await self.get(
            f"/{self.project.slug}/configurations", headers=INERTIA_HEADERS
        )

        response.assert_ok().assert_json(
            lambda j: j.has(
                "props",
                lambda p: p.has(
                    "commands",
                    1,
                    lambda cs: cs.first(lambda c: c.where("status", "stopped").etc()),
                ).etc(),
            ).etc()
        )
        refreshed = await Command.find(command.id)
        self.assertEqual(refreshed.status, "stopped")
        self.assertIsNone(refreshed.pid)

    async def test_page_unknown_project_returns_empty_commands(self):
        response = await self.get(
            "/nonexistent-project-slug/configurations", headers=INERTIA_HEADERS
        )
        response.assert_ok().assert_json(
            lambda j: j.has(
                "props",
                lambda p: p.where("project_id", None).where("commands", []).etc(),
            ).etc()
        )
