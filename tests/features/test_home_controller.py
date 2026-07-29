from unittest.mock import patch

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Project import Project
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

_INERTIA = {"X-Inertia": "true", "X-Inertia-Version": ""}


class TestHomeController(TestCase, DatabaseTransaction):
    async def test_visiting_agent_page_bumps_updated_at(self):
        project = await ProjectFactory.new().create(updated_at="2020-01-01 00:00:00")

        response = await self.get(f"/{project.slug}/agents/1", headers=_INERTIA)
        response.assert_ok()

        refreshed = await Project.where("slug", project.slug).first()
        self.assertGreater(refreshed.updated_at, "2020-01-01 00:00:00")

    async def test_shared_props_orders_projects_by_updated_at_desc(self):
        oldest = await ProjectFactory.new().create(updated_at="2099-01-01 00:00:00")
        newest = await ProjectFactory.new().create(updated_at="2099-01-03 00:00:00")

        response = await self.get(f"/{oldest.slug}", headers=_INERTIA)
        response.assert_ok()

        slugs = [row["slug"] for row in response.json()["props"]["projects"]]
        mine = [s for s in slugs if s in {oldest.slug, newest.slug}]
        self.assertEqual(mine, [newest.slug, oldest.slug])

    async def test_shared_props_caps_projects_regardless_of_a_request_per_page(self):
        """The Inertia-rendered `projects` sidebar prop previously came from an
        unbounded `Project...get()` with no limit/paginate applied at all —
        this creates more projects than the (patched, small) cap and asserts
        the props list is still capped. Would have FAILED before the cap was
        added, since the old query returned every row unconditionally."""
        projects = [
            await ProjectFactory.new().create(updated_at=f"2099-02-0{i + 1} 00:00:00")
            for i in range(3)
        ]

        with patch("app.controllers.home_controller.SIDEBAR_PROJECTS_LIMIT", 2):
            response = await self.get(f"/{projects[0].slug}", headers=_INERTIA)
        response.assert_ok()

        slugs = [row["slug"] for row in response.json()["props"]["projects"]]
        mine = [s for s in slugs if s in {p.slug for p in projects}]
        self.assertEqual(len(mine), 2)
        self.assertEqual(mine, [projects[2].slug, projects[1].slug])
