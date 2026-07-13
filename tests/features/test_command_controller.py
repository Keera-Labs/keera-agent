from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Command import Command
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestCommandController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    async def _create_command(self) -> Command:
        return await Command.create(
            {
                "project_id": self.project.id,
                "label": "List files",
                "command": "ls -la",
                "description": "",
                "category": "General",
                "shortcut": "",
                "status": "stopped",
            }
        )

    async def test_destroy_deletes_command(self):
        command = await self._create_command()

        response = await self.delete(f"/api/commands/{command.id}")

        response.assert_no_content()
        self.assertIsNone(await Command.find(command.id))

    async def test_destroy_returns_bodyless_204(self):
        """A 204 must carry no body. A JSON body ({}) sets Content-Length: 0 while
        writing 2 bytes, raising a server-side "Response content longer than
        Content-Length" RuntimeError on every delete. Assert the body is empty."""
        command = await self._create_command()

        response = await self.delete(f"/api/commands/{command.id}")

        response.assert_no_content()
        assert response.content == b"", f"expected empty 204 body, got {response.content!r}"

    async def test_destroy_missing_command_returns_404(self):
        response = await self.delete("/api/commands/999999")
        response.assert_status(404)
