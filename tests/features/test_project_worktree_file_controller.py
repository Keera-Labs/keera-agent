from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Project import Project
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestProjectWorktreeFileController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()

    def url(self, project_id: int | None = None) -> str:
        return f"/api/projects/{project_id or self.project.id}/worktree-files"

    async def test_show_returns_an_empty_list_by_default(self):
        response = await self.get(self.url())

        response.assert_ok()
        self.assertEqual(response.json()["data"], {"paths": []})

    async def test_update_persists_paths_as_a_list(self):
        paths = [".env", ".env.local", "config/*.local.json", "storage/"]

        response = await self.put(self.url(), json={"paths": paths})

        response.assert_ok()
        self.assertEqual(response.json()["data"]["paths"], paths)
        project = await Project.find(self.project.id)
        self.assertEqual(project.worktree_copy_paths, paths)
        shown = await self.get(self.url())
        self.assertEqual(shown.json()["data"]["paths"], paths)

    async def test_update_trims_blanks_and_duplicates(self):
        response = await self.put(self.url(), json={"paths": [" .env ", "", ".env", "  "]})

        response.assert_ok()
        self.assertEqual(response.json()["data"]["paths"], [".env"])

    async def test_update_with_an_empty_list_clears_the_setting(self):
        await self.put(self.url(), json={"paths": [".env"]})

        response = await self.put(self.url(), json={"paths": []})

        response.assert_ok()
        self.assertEqual(response.json()["data"]["paths"], [])

    async def test_update_rejects_paths_escaping_the_project_root(self):
        for path in (
            "/etc/passwd",
            "../secrets/.env",
            "config/../../.env",
            "~/.ssh/id_rsa",
            "C:\\x",
        ):
            with self.subTest(path=path):
                response = await self.put(self.url(), json={"paths": [".env", path]})
                response.assert_status(422)

        project = await Project.find(self.project.id)
        self.assertFalse(project.worktree_copy_paths)

    async def test_missing_project_returns_404(self):
        (await self.get(self.url(999999))).assert_status(404)
        (await self.put(self.url(999999), json={"paths": []})).assert_status(404)
