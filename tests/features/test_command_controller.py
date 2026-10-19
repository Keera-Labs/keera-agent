from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Command import Command
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


class TestCommandController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    async def _create_command(self, **overrides) -> Command:
        return await Command.create(
            {"project_id": self.project.id, "label": "List files", "command": "ls -la", **overrides}
        )

    async def test_store_creates_a_run_command_by_default(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/commands",
            json={"label": " Dev ", "command": "npm run dev"},
        )

        response.assert_ok()
        data = response.json()["data"]
        self.assertEqual(data["type"], "commands")
        self.assertEqual(data["attributes"]["label"], "Dev")
        self.assertEqual(data["attributes"]["kind"], "run")
        self.assertIsNone(data["attributes"]["run"])
        stored = await Command.find(int(data["id"]))
        self.assertEqual(stored.project_id, self.project.id)

    async def test_store_accepts_the_setup_kind(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/commands",
            json={"label": "Install", "command": "npm install", "kind": "setup"},
        )

        response.assert_ok()
        self.assertEqual(response.json()["data"]["attributes"]["kind"], "setup")

    async def test_store_rejects_an_unknown_kind(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/commands",
            json={"label": "Install", "command": "npm install", "kind": "deploy"},
        )

        response.assert_status(422)

    async def test_store_requires_label_and_command(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/commands", json={"label": "  ", "command": ""}
        )

        response.assert_status(422)

    async def test_store_for_a_missing_project_returns_404(self):
        response = await self.post(
            "/api/projects/999999/commands", json={"label": "Dev", "command": "npm run dev"}
        )

        response.assert_status(404)

    async def test_index_lists_the_project_commands_without_runs(self):
        command = await self._create_command()
        await Command.create({"project_id": 999999, "label": "Other", "command": "true"})

        response = await self.get(f"/api/projects/{self.project.id}/commands")

        response.assert_ok()
        data = response.json()["data"]
        self.assertEqual([item["id"] for item in data], [str(command.id)])
        self.assertIsNone(data[0]["attributes"]["run"])

    async def test_index_rejects_an_unknown_worktree(self):
        response = await self.get(
            f"/api/projects/{self.project.id}/commands",
            params={"worktree": str(self.repo.base / "elsewhere")},
        )

        response.assert_status(422)

    async def test_update_changes_only_the_given_fields(self):
        command = await self._create_command(description="keep me")

        response = await self.patch(
            f"/api/commands/{command.id}", json={"label": "Dev", "kind": "setup"}
        )

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual(attributes["label"], "Dev")
        self.assertEqual(attributes["kind"], "setup")
        self.assertEqual(attributes["command"], "ls -la")
        self.assertEqual(attributes["description"], "keep me")

    async def test_update_rejects_an_empty_command(self):
        command = await self._create_command()

        response = await self.patch(f"/api/commands/{command.id}", json={"command": "  "})

        response.assert_status(422)

    async def test_destroy_deletes_command_with_a_bodyless_204(self):
        command = await self._create_command()

        response = await self.delete(f"/api/commands/{command.id}")

        response.assert_no_content()
        self.assertEqual(response.content, b"")
        self.assertIsNone(await Command.find(command.id))

    async def test_destroy_missing_command_returns_404(self):
        response = await self.delete("/api/commands/999999")

        response.assert_status(404)
