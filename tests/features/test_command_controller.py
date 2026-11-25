from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Command import Command
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase

LARAVEL_SETUP = "cp ../../../.env ./.env && composer install && php artisan serve --port=8000"
MULTI_LINE_SCRIPT = (
    "set -e\n"
    'echo "it\'s a \\"quoted\\" value" | tr a-z A-Z\n'
    "cat package.json | grep -E 'dev|build' || true\n"
    "\tprintf '%s\\n' \"$HOME\" | wc -c"
)


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

    async def test_store_keeps_a_chained_shell_command_verbatim(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/commands",
            json={"label": "Laravel", "command": LARAVEL_SETUP},
        )

        response.assert_ok()
        data = response.json()["data"]
        self.assertEqual(data["attributes"]["command"], LARAVEL_SETUP)
        self.assertEqual((await Command.find(int(data["id"]))).command, LARAVEL_SETUP)

    async def test_store_keeps_a_multi_line_script_and_index_returns_it(self):
        response = await self.post(
            f"/api/projects/{self.project.id}/commands",
            json={"label": "Script", "command": f"\n  {MULTI_LINE_SCRIPT}\n\n"},
        )

        response.assert_ok()
        data = response.json()["data"]
        self.assertEqual(data["attributes"]["command"], MULTI_LINE_SCRIPT)
        self.assertEqual((await Command.find(int(data["id"]))).command, MULTI_LINE_SCRIPT)
        listed = (await self.get(f"/api/projects/{self.project.id}/commands")).json()["data"]
        scripts = {item["id"]: item["attributes"]["command"] for item in listed}
        self.assertEqual(scripts[data["id"]], MULTI_LINE_SCRIPT)

    async def test_update_keeps_a_multi_line_script_and_index_returns_it(self):
        command = await self._create_command()

        response = await self.patch(
            f"/api/commands/{command.id}", json={"command": MULTI_LINE_SCRIPT}
        )

        response.assert_ok()
        self.assertEqual(response.json()["data"]["attributes"]["command"], MULTI_LINE_SCRIPT)
        self.assertEqual((await Command.find(command.id)).command, MULTI_LINE_SCRIPT)
        listed = (await self.get(f"/api/projects/{self.project.id}/commands")).json()["data"]
        self.assertEqual(listed[0]["attributes"]["command"], MULTI_LINE_SCRIPT)

    async def test_store_rejects_an_empty_or_whitespace_only_script(self):
        for script in ["", "   ", "\n\t\n  \n"]:
            with self.subTest(script=script):
                response = await self.post(
                    f"/api/projects/{self.project.id}/commands",
                    json={"label": "Script", "command": script},
                )

                response.assert_status(422)
                self.assertIn("command", response.json()["errors"])

    async def test_update_rejects_a_multi_line_whitespace_only_script(self):
        command = await self._create_command()

        response = await self.patch(f"/api/commands/{command.id}", json={"command": "\n \n\t"})

        response.assert_status(422)
        self.assertIn("command", response.json()["errors"])
        self.assertEqual((await Command.find(command.id)).command, "ls -la")

    async def test_destroy_deletes_command_with_a_bodyless_204(self):
        command = await self._create_command()

        response = await self.delete(f"/api/commands/{command.id}")

        response.assert_no_content()
        self.assertEqual(response.content, b"")
        self.assertIsNone(await Command.find(command.id))

    async def test_destroy_missing_command_returns_404(self):
        response = await self.delete("/api/commands/999999")

        response.assert_status(404)
