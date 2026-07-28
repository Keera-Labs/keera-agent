from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestProjectController(TestCase, DatabaseTransaction):
    """`index` is a global (unscoped) list, so tests stamp their own projects
    with far-future ``last_opened_at`` values that dominate any pre-existing
    rows in the shared test DB, then assert on the relative order of those
    known slugs rather than absolute positions."""

    async def test_index_orders_by_last_opened_desc(self):
        oldest = await ProjectFactory.new().create(last_opened_at="2099-01-01 00:00:00")
        newest = await ProjectFactory.new().create(last_opened_at="2099-01-03 00:00:00")
        middle = await ProjectFactory.new().create(last_opened_at="2099-01-02 00:00:00")

        response = await self.get("/api/projects")
        response.assert_ok()

        slugs = [row["slug"] for row in response.json()]
        mine = [s for s in slugs if s in {oldest.slug, newest.slug, middle.slug}]
        self.assertEqual(mine, [newest.slug, middle.slug, oldest.slug])

    async def test_index_falls_back_to_created_at_when_never_opened(self):
        opened = await ProjectFactory.new().create(last_opened_at="2099-05-01 00:00:00")
        never = await ProjectFactory.new().create()  # last_opened_at is NULL

        response = await self.get("/api/projects")
        response.assert_ok()

        slugs = [row["slug"] for row in response.json()]
        # Never-opened projects still appear (COALESCE to created_at)…
        self.assertIn(never.slug, slugs)
        # …and rank below a project opened in the far future.
        self.assertLess(slugs.index(opened.slug), slugs.index(never.slug))

    async def test_index_respects_per_page(self):
        await ProjectFactory.new().create(last_opened_at="2099-03-01 00:00:00")
        second = await ProjectFactory.new().create(last_opened_at="2099-03-02 00:00:00")
        newest = await ProjectFactory.new().create(last_opened_at="2099-03-03 00:00:00")

        response = await self.get("/api/projects?per_page=2")
        response.assert_ok()

        slugs = [row["slug"] for row in response.json()]
        self.assertEqual(len(slugs), 2)
        self.assertEqual(slugs, [newest.slug, second.slug])

    async def test_index_second_page_returns_next_slice(self):
        newest = await ProjectFactory.new().create(last_opened_at="2099-04-03 00:00:00")
        second = await ProjectFactory.new().create(last_opened_at="2099-04-02 00:00:00")

        page1 = (await self.get("/api/projects?per_page=1&page=1")).json()
        page2 = (await self.get("/api/projects?per_page=1&page=2")).json()

        self.assertEqual([r["slug"] for r in page1], [newest.slug])
        self.assertEqual([r["slug"] for r in page2], [second.slug])
