import datetime

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Task import Task
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


def _attrs(response) -> dict:
    """Extract the attributes of a single JSON:API task resource document."""
    return response.json()["data"]["attributes"]


class TestTaskController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        # `index` is project-scoped and the surrounding transaction is rolled
        # back after each test, so no manual cleanup is needed.
        self.project = await ProjectFactory.new().create()

    @property
    def tasks_url(self) -> str:
        return f"/api/projects/{self.project.id}/tasks"

    # --- store ---

    async def test_store_creates_task_with_defaults(self):
        response = await self.post(self.tasks_url, json={"title": "Write docs"})
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertEqual(attrs["title"], "Write docs")
        self.assertEqual(attrs["status"], "pending")
        self.assertEqual(attrs["priority"], "medium")
        self.assertEqual(attrs["project_id"], self.project.id)
        self.assertEqual(attrs["assignees"], [])
        self.assertEqual(attrs["acceptance_criteria"], [])
        self.assertEqual(attrs["testing_methods"], [])
        self.assertEqual(attrs["validation_steps"], [])

    async def test_store_persists_all_fields_as_lists(self):
        payload = (await TaskFactory.new().make()).serialize()

        response = await self.post(self.tasks_url, json=payload)
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertEqual(attrs["title"], payload["title"])
        self.assertEqual(attrs["body"], payload["body"])
        self.assertEqual(attrs["priority"], payload["priority"])
        self.assertEqual(attrs["assignees"], payload["assignees"])
        self.assertEqual(attrs["acceptance_criteria"], payload["acceptance_criteria"])
        self.assertEqual(attrs["testing_methods"], payload["testing_methods"])
        self.assertEqual(attrs["validation_steps"], payload["validation_steps"])

    async def test_store_strips_title_whitespace(self):
        response = await self.post(self.tasks_url, json={"title": "  spaced  "})
        self.assertEqual(_attrs(response)["title"], "spaced")

    async def test_store_rejects_blank_title(self):
        response = await self.post(self.tasks_url, json={"title": "   "})
        self.assertEqual(response.status_code, 422)

    async def test_store_rejects_missing_title(self):
        response = await self.post(self.tasks_url, json={})
        self.assertEqual(response.status_code, 422)

    # --- index ---

    async def test_index_returns_active_tasks_as_lists(self):
        await TaskFactory.new().create(project_id=self.project.id, title="one", assignees=["alice"])
        await TaskFactory.new().create(project_id=self.project.id, title="two")

        response = await self.get(self.tasks_url)
        self.assertEqual(response.status_code, 200)
        rows = {row["attributes"]["title"]: row["attributes"] for row in response.json()["data"]}
        self.assertIn("one", rows)
        self.assertIn("two", rows)
        # JSON columns come back parsed even when read from the DB.
        self.assertEqual(rows["one"]["assignees"], ["alice"])

    async def test_index_scoped_to_project(self):
        await TaskFactory.new().create(project_id=self.project.id, title="mine")
        other = await ProjectFactory.new().create()

        response = await self.get(f"/api/projects/{other.id}/tasks")
        titles = {row["attributes"]["title"] for row in response.json()["data"]}
        self.assertNotIn("mine", titles)

    async def test_index_excludes_old_completed_tasks(self):
        stale = (datetime.datetime.now() - datetime.timedelta(days=30)).isoformat()
        await TaskFactory.new().create(
            project_id=self.project.id, title="stale-task", status="completed", completed_at=stale,
        )
        await TaskFactory.new().create(project_id=self.project.id, title="active-task")

        response = await self.get(self.tasks_url)
        titles = {row["attributes"]["title"] for row in response.json()["data"]}
        self.assertIn("active-task", titles)
        self.assertNotIn("stale-task", titles)

    # --- update ---

    async def test_update_modifies_fields(self):
        task = await TaskFactory.new().create(project_id=self.project.id, title="old")

        response = await self.client.patch(f"/api/tasks/{task.id}", json={
            "title": "new title",
            "assignees": ["carol"],
        })
        self.assertEqual(response.status_code, 200)
        attrs = _attrs(response)
        self.assertEqual(attrs["title"], "new title")
        self.assertEqual(attrs["assignees"], ["carol"])

    async def test_update_to_terminal_status_sets_completed_at(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.client.patch(f"/api/tasks/{task.id}", json={"status": "completed"})
        attrs = _attrs(response)
        self.assertEqual(attrs["status"], "completed")
        self.assertIsNotNone(attrs["completed_at"])

    async def test_update_to_non_terminal_status_clears_completed_at(self):
        task = await TaskFactory.new().create(project_id=self.project.id)
        await self.client.patch(f"/api/tasks/{task.id}", json={"status": "completed"})

        response = await self.client.patch(f"/api/tasks/{task.id}", json={"status": "in_progress"})
        attrs = _attrs(response)
        self.assertEqual(attrs["status"], "in_progress")
        self.assertIsNone(attrs["completed_at"])

    async def test_update_missing_task_returns_404(self):
        response = await self.client.patch("/api/tasks/999999", json={"title": "nope"})
        self.assertEqual(response.status_code, 404)

    # --- destroy ---

    async def test_destroy_deletes_task(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.client.delete(f"/api/tasks/{task.id}")
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(await Task.find(task.id))

    async def test_destroy_missing_task_returns_404(self):
        response = await self.client.delete("/api/tasks/999999")
        self.assertEqual(response.status_code, 404)
