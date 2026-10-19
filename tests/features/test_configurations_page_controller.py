from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

INERTIA_HEADERS = {"X-Inertia": "true", "X-Inertia-Version": ""}


class TestConfigurationsPageController(TestCase, DatabaseTransaction):
    async def test_page_renders_the_project_props(self):
        project = await ProjectFactory.new().create()

        response = await self.get(f"/{project.slug}/configurations", headers=INERTIA_HEADERS)

        response.assert_ok().assert_json(
            lambda j: j.has(
                "props",
                lambda p: p.where("project", project.slug).where("project_id", project.id).etc(),
            ).etc()
        )

    async def test_page_for_an_unknown_project_has_no_project_id(self):
        response = await self.get(
            "/nonexistent-project-slug/configurations", headers=INERTIA_HEADERS
        )

        response.assert_ok().assert_json(
            lambda j: j.has("props", lambda p: p.where("project_id", None).etc()).etc()
        )
