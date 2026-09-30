from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Workspace import Workspace
from databases.factories.workspace_factory import WorkspaceFactory
from tests.test_case import TestCase


class TestWorkspaceController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.workspace = await WorkspaceFactory.new().create(name="Office")

    @property
    def url(self) -> str:
        return f"/api/workspaces/{self.workspace.id}"

    async def _fresh(self) -> Workspace:
        return await Workspace.find(self.workspace.id)

    async def test_update_sets_claude_config_dir(self):
        response = await self.patch(self.url, json={"claude_config_dir": " ~/.claude-work "})

        response.assert_ok()
        self.assertEqual(
            response.json()["data"]["attributes"]["claude_config_dir"], "~/.claude-work"
        )
        self.assertEqual((await self._fresh()).claude_config_dir, "~/.claude-work")

    async def test_update_accepts_an_absolute_path(self):
        response = await self.patch(self.url, json={"claude_config_dir": "/opt/claude-work"})

        response.assert_ok()
        self.assertEqual((await self._fresh()).claude_config_dir, "/opt/claude-work")

    async def test_blank_or_null_clears_claude_config_dir(self):
        for cleared in ("", "   ", None):
            await self.workspace.update({"claude_config_dir": "~/.claude-work"})

            response = await self.patch(self.url, json={"claude_config_dir": cleared})

            response.assert_ok()
            self.assertIsNone((await self._fresh()).claude_config_dir, repr(cleared))

    async def test_relative_claude_config_dir_is_rejected(self):
        response = await self.patch(self.url, json={"claude_config_dir": "claude-work"})

        response.assert_status(422)
        self.assertIsNone((await self._fresh()).claude_config_dir)

    async def test_other_users_home_is_rejected_with_a_message(self):
        response = await self.patch(self.url, json={"claude_config_dir": "~nosuchuser/x"})

        response.assert_status(422)
        messages = response.json()["errors"]["claude_config_dir"]
        self.assertIn("absolute path or start with ~/", messages[0])
        self.assertIsNone((await self._fresh()).claude_config_dir)

    async def test_blank_name_is_rejected(self):
        response = await self.patch(self.url, json={"name": "  "})

        response.assert_status(422)
        self.assertEqual((await self._fresh()).name, "Office")

    async def test_renaming_leaves_claude_config_dir_untouched(self):
        await self.workspace.update({"claude_config_dir": "~/.claude-work"})

        response = await self.patch(self.url, json={"name": "Work", "description": "Day job"})

        response.assert_ok()
        workspace = await self._fresh()
        self.assertEqual(workspace.name, "Work")
        self.assertEqual(workspace.description, "Day job")
        self.assertEqual(workspace.claude_config_dir, "~/.claude-work")

    async def test_unknown_workspace_is_not_found(self):
        response = await self.patch("/api/workspaces/999999", json={"name": "x"})

        response.assert_status(404)

    async def test_index_exposes_claude_config_dir(self):
        await self.workspace.update({"claude_config_dir": "~/.claude-work"})

        response = await self.get("/api/workspaces")

        response.assert_ok()
        row = next(w for w in response.json()["data"] if w["id"] == str(self.workspace.id))
        self.assertEqual(row["attributes"]["claude_config_dir"], "~/.claude-work")
