from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Project import Project
from databases.factories.project_factory import ProjectFactory
from databases.factories.workspace_factory import WorkspaceFactory
from tests.test_case import TestCase

_INERTIA = {"X-Inertia": "true", "X-Inertia-Version": ""}


class TestProjectVisibilityController(TestCase, DatabaseTransaction):
    async def test_hiding_clears_last_opened_at_without_deleting(self):
        project = await ProjectFactory.new().create(last_opened_at="2099-01-01 00:00:00")

        response = await self.patch(f"/api/projects/{project.id}/visibility", json={"hidden": True})
        response.assert_ok()

        attributes = response.json()["data"]["attributes"]
        self.assertTrue(attributes["hidden"])
        self.assertIsNone(attributes["last_opened_at"])
        refreshed = await Project.find(project.id)
        self.assertIsNotNone(refreshed)
        self.assertIsNone(refreshed.last_opened_at)

    async def test_unhiding_stamps_last_opened_at(self):
        project = await ProjectFactory.new().create(last_opened_at=None)

        response = await self.patch(
            f"/api/projects/{project.id}/visibility", json={"hidden": False}
        )
        response.assert_ok()

        self.assertFalse(response.json()["data"]["attributes"]["hidden"])
        refreshed = await Project.find(project.id)
        self.assertIsNotNone(refreshed.last_opened_at)

    async def test_hidden_must_be_a_boolean(self):
        project = await ProjectFactory.new().create()

        response = await self.patch(f"/api/projects/{project.id}/visibility", json={})

        self.assertEqual(response.status_code, 422)

    async def test_unknown_project_is_404(self):
        response = await self.patch("/api/projects/999999999/visibility", json={"hidden": True})

        self.assertEqual(response.status_code, 404)

    async def test_sidebar_list_excludes_hidden_but_search_includes_them(self):
        workspace = await WorkspaceFactory.new().create()
        visible = await ProjectFactory.new().create(
            workspace_id=workspace.id, last_opened_at="2099-01-01 00:00:00"
        )
        hidden = await ProjectFactory.new().create(workspace_id=workspace.id, last_opened_at=None)

        sidebar = (await self.get(f"/api/projects?workspace_id={workspace.id}")).json()
        search = (
            await self.get(f"/api/projects?workspace_id={workspace.id}&include_hidden=1")
        ).json()

        self.assertEqual([row["slug"] for row in sidebar], [visible.slug])
        self.assertEqual([row["slug"] for row in search], [visible.slug, hidden.slug])

    async def test_sidebar_props_exclude_hidden_projects(self):
        visible = await ProjectFactory.new().create(last_opened_at="2099-01-01 00:00:00")
        hidden = await ProjectFactory.new().create(last_opened_at=None)

        response = await self.get("/settings", headers=_INERTIA)
        response.assert_ok()

        slugs = {row["slug"] for row in response.json()["props"]["projects"]}
        self.assertIn(visible.slug, slugs)
        self.assertNotIn(hidden.slug, slugs)

    async def test_opening_a_hidden_project_by_url_brings_it_back_to_the_top(self):
        await ProjectFactory.new().create(last_opened_at="2099-01-01 00:00:00")
        hidden = await ProjectFactory.new().create(last_opened_at=None)

        response = await self.get(f"/{hidden.slug}/agents/1", headers=_INERTIA)
        response.assert_ok()

        refreshed = await Project.find(hidden.id)
        self.assertIsNotNone(refreshed.last_opened_at)
        self.assertIn(hidden.slug, {row["slug"] for row in response.json()["props"]["projects"]})

    async def test_opening_a_hidden_project_without_agents_unhides_it(self):
        hidden = await ProjectFactory.new().create(last_opened_at=None)

        response = await self.get(f"/{hidden.slug}", headers=_INERTIA)
        response.assert_ok()

        refreshed = await Project.find(hidden.id)
        self.assertIsNotNone(refreshed.last_opened_at)
