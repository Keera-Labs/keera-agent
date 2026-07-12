import datetime

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Task import Task
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


def _data_attrs(callback):
    """Build an assert_json callback that scopes into a single JSON:API
    resource's ``data.attributes`` and runs ``callback`` against them."""
    return lambda j: j.has("data", lambda d: d.has("attributes", callback).etc()).etc()


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
        response.assert_ok().assert_json(
            _data_attrs(
                lambda a: (
                    a.where("title", "Write docs")
                    .where("status", "pending")
                    .where("priority", "medium")
                    .where("project_id", self.project.id)
                    .where("assignees", [])
                    .where("acceptance_criteria", [])
                    .where("testing_methods", [])
                    .where("validation_steps", [])
                    .etc()
                )
            )
        )

    async def test_store_persists_all_fields_as_lists(self):
        payload = (await TaskFactory.new().make()).serialize()

        response = await self.post(self.tasks_url, json=payload)
        response.assert_ok().assert_json(
            _data_attrs(
                lambda a: (
                    a.where("title", payload["title"])
                    .where("body", payload["body"])
                    .where("priority", payload["priority"])
                    .where("assignees", payload["assignees"])
                    .where("acceptance_criteria", payload["acceptance_criteria"])
                    .where("testing_methods", payload["testing_methods"])
                    .where("validation_steps", payload["validation_steps"])
                    .etc()
                )
            )
        )

    async def test_store_strips_title_whitespace(self):
        response = await self.post(self.tasks_url, json={"title": "  spaced  "})
        response.assert_json(_data_attrs(lambda a: a.where("title", "spaced").etc()))

    async def test_store_rejects_blank_title(self):
        response = await self.post(self.tasks_url, json={"title": "   "})
        response.assert_status(422)

    async def test_store_rejects_missing_title(self):
        response = await self.post(self.tasks_url, json={})
        response.assert_status(422)

    async def test_store_accepts_valid_complexity(self):
        response = await self.post(
            self.tasks_url, json={"title": "Hard one", "complexity": "hard"}
        )
        response.assert_ok().assert_json(
            _data_attrs(lambda a: a.where("complexity", "hard").etc())
        )

    async def test_store_rejects_invalid_complexity(self):
        response = await self.post(
            self.tasks_url, json={"title": "Bad", "complexity": "trivial"}
        )
        response.assert_status(422)

    async def test_store_defaults_complexity_to_null(self):
        response = await self.post(self.tasks_url, json={"title": "No complexity"})
        response.assert_ok().assert_json(
            _data_attrs(lambda a: a.where("complexity", lambda v: v is None).etc())
        )

    async def test_update_sets_complexity(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"complexity": "easy"})
        response.assert_ok().assert_json(
            _data_attrs(lambda a: a.where("complexity", "easy").etc())
        )

    async def test_update_rejects_invalid_complexity(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"complexity": "nope"})
        response.assert_status(422)

    # --- index ---

    async def test_index_returns_active_tasks_as_lists(self):
        await TaskFactory.new().create(project_id=self.project.id, title="one", assignees=["alice"])
        await TaskFactory.new().create(project_id=self.project.id, title="two")

        response = await self.get(self.tasks_url)
        response.assert_ok()
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
            project_id=self.project.id,
            title="stale-task",
            status="completed",
            completed_at=stale,
        )
        await TaskFactory.new().create(project_id=self.project.id, title="active-task")

        response = await self.get(self.tasks_url)
        titles = {row["attributes"]["title"] for row in response.json()["data"]}
        self.assertIn("active-task", titles)
        self.assertNotIn("stale-task", titles)

    # --- update ---

    async def test_update_modifies_fields(self):
        task = await TaskFactory.new().create(project_id=self.project.id, title="old")

        response = await self.patch(
            f"/api/tasks/{task.id}",
            json={
                "title": "new title",
                "assignees": ["carol"],
            },
        )
        response.assert_ok().assert_json(
            _data_attrs(lambda a: a.where("title", "new title").where("assignees", ["carol"]).etc())
        )

    async def test_update_to_terminal_status_sets_completed_at(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"status": "completed"})
        response.assert_json(
            _data_attrs(
                lambda a: (
                    a.where("status", "completed")
                    .where("completed_at", lambda v: v is not None)
                    .etc()
                )
            )
        )

    async def test_update_to_non_terminal_status_clears_completed_at(self):
        task = await TaskFactory.new().create(project_id=self.project.id)
        await self.patch(f"/api/tasks/{task.id}", json={"status": "completed"})

        response = await self.patch(f"/api/tasks/{task.id}", json={"status": "in_progress"})
        response.assert_json(
            _data_attrs(
                lambda a: (
                    a.where("status", "in_progress")
                    .where("completed_at", lambda v: v is None)
                    .etc()
                )
            )
        )

    async def test_update_missing_task_returns_404(self):
        response = await self.patch("/api/tasks/999999", json={"title": "nope"})
        response.assert_status(404)

    # --- destroy ---

    async def test_destroy_deletes_task(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.delete(f"/api/tasks/{task.id}")
        response.assert_no_content()
        self.assertIsNone(await Task.find(task.id))

    async def test_destroy_missing_task_returns_404(self):
        response = await self.delete("/api/tasks/999999")
        response.assert_status(404)
