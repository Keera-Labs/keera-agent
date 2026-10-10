import datetime
import os
import time
from unittest.mock import patch

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
        response = await self.post(self.tasks_url, json={"title": "Hard one", "complexity": "hard"})
        response.assert_ok().assert_json(_data_attrs(lambda a: a.where("complexity", "hard").etc()))

    async def test_store_rejects_invalid_complexity(self):
        response = await self.post(self.tasks_url, json={"title": "Bad", "complexity": "trivial"})
        response.assert_status(422)

    async def test_store_defaults_complexity_to_null(self):
        response = await self.post(self.tasks_url, json={"title": "No complexity"})
        response.assert_ok().assert_json(
            _data_attrs(lambda a: a.where("complexity", lambda v: v is None).etc())
        )

    async def test_update_sets_complexity(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"complexity": "easy"})
        response.assert_ok().assert_json(_data_attrs(lambda a: a.where("complexity", "easy").etc()))

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

    async def test_index_meta_total_counts_every_task_beyond_the_first_page(self):
        stale = (datetime.datetime.now() - datetime.timedelta(days=14)).isoformat()
        for i in range(40):
            await TaskFactory.new().create(project_id=self.project.id, title=f"open-{i}")
        await TaskFactory.new().create(
            project_id=self.project.id,
            title="stale-done",
            status="completed",
            completed_at=stale,
        )

        response = await self.get(self.tasks_url)
        response.assert_ok()
        body = response.json()
        self.assertEqual(len(body["data"]), 15)
        self.assertEqual(body["meta"]["total"], 40)

    async def test_index_meta_total_matches_task_count_at_the_page_boundary(self):
        for i in range(16):
            await TaskFactory.new().create(project_id=self.project.id, title=f"boundary-{i}")

        body = (await self.get(self.tasks_url)).json()
        self.assertEqual(len(body["data"]), 15)
        self.assertEqual(body["meta"]["total"], 16)

    async def test_index_scoped_to_project(self):
        await TaskFactory.new().create(project_id=self.project.id, title="mine")
        other = await ProjectFactory.new().create()

        response = await self.get(f"/api/projects/{other.id}/tasks")
        titles = {row["attributes"]["title"] for row in response.json()["data"]}
        self.assertNotIn("mine", titles)

    async def test_index_includes_recent_completed_tasks_and_excludes_old_ones(self):
        recent = (datetime.datetime.now() - datetime.timedelta(days=6)).isoformat()
        stale = (datetime.datetime.now() - datetime.timedelta(days=14)).isoformat()
        await TaskFactory.new().create(
            project_id=self.project.id,
            title="recent-task",
            status="completed",
            completed_at=recent,
        )
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
        self.assertIn("recent-task", titles)
        self.assertNotIn("stale-task", titles)

    async def test_index_excludes_completed_tasks_without_a_completion_timestamp(self):
        await TaskFactory.new().create(
            project_id=self.project.id,
            title="legacy-completed-task",
            status="completed",
            completed_at=None,
        )

        response = await self.get(self.tasks_url)
        titles = {row["attributes"]["title"] for row in response.json()["data"]}
        self.assertNotIn("legacy-completed-task", titles)

    async def test_index_includes_completion_at_the_seven_day_cutoff(self):
        now = datetime.datetime(2026, 9, 6, 12, 0, 0)
        cutoff = now - datetime.timedelta(days=7)
        await TaskFactory.new().create(
            project_id=self.project.id,
            title="at-cutoff",
            status="completed",
            completed_at=cutoff.isoformat(),
        )
        await TaskFactory.new().create(
            project_id=self.project.id,
            title="before-cutoff",
            status="completed",
            completed_at=(cutoff - datetime.timedelta(microseconds=1)).isoformat(),
        )

        with patch("app.controllers.task_controller.datetime.datetime") as mocked_datetime:
            mocked_datetime.now.return_value = now
            response = await self.get(self.tasks_url)

        titles = {row["attributes"]["title"] for row in response.json()["data"]}
        self.assertIn("at-cutoff", titles)
        self.assertNotIn("before-cutoff", titles)

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

    async def test_update_to_terminal_status_stamps_completed_at_in_utc(self):
        # Run the server clock in a non-UTC zone: if completed_at were stamped
        # with local time (the bug), it would land hours away from real UTC now.
        task = await TaskFactory.new().create(project_id=self.project.id)
        original_tz = os.environ.get("TZ")
        os.environ["TZ"] = "America/New_York"
        time.tzset()
        try:
            before = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            response = await self.patch(f"/api/tasks/{task.id}", json={"status": "completed"})
            after = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        finally:
            if original_tz is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = original_tz
            time.tzset()

        completed_at = response.json()["data"]["attributes"]["completed_at"]
        # Naive, like created_at — no UTC offset or "Z" suffix.
        self.assertNotRegex(completed_at, r"(Z|[+-]\d{2}:?\d{2})$")
        stamped = datetime.datetime.fromisoformat(completed_at)
        self.assertGreaterEqual(stamped, before - datetime.timedelta(seconds=5))
        self.assertLessEqual(stamped, after + datetime.timedelta(seconds=5))

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

    async def test_update_accepts_in_review_status_without_completing(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"status": "in_review"})
        response.assert_ok().assert_json(
            _data_attrs(
                lambda a: (
                    a.where("status", "in_review").where("completed_at", lambda v: v is None).etc()
                )
            )
        )

    async def test_update_rejects_unknown_status(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"status": "shipped"})
        response.assert_status(422)

    async def test_update_sets_review_fields(self):
        task = await TaskFactory.new().create(project_id=self.project.id)
        fields = {
            "pr_number": 368,
            "pr_url": "https://github.com/acme/app/pull/368",
            "branch": "task/tasks-page",
            "additions": 120,
            "deletions": 14,
            "review_note": "Needs a second look at the migration.",
            "progress_step": 2,
            "progress_total": 5,
        }

        response = await self.patch(f"/api/tasks/{task.id}", json=fields)

        response.assert_ok()
        attributes = response.json()["data"]["attributes"]
        self.assertEqual({k: attributes[k] for k in fields}, fields)

    async def test_new_task_has_null_review_fields(self):
        response = await self.post(self.tasks_url, json={"title": "Fresh"})

        attributes = response.json()["data"]["attributes"]
        for field in ("pr_number", "pr_url", "branch", "progress_step", "completed_at"):
            self.assertIsNone(attributes[field], field)

    async def test_update_rejects_negative_diff_counts(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.patch(f"/api/tasks/{task.id}", json={"additions": -1})
        response.assert_status(422)

    async def test_editing_a_completed_task_keeps_completed_at(self):
        stamp = "2026-09-20T10:00:00"
        task = await TaskFactory.new().create(
            project_id=self.project.id, status="completed", completed_at=stamp
        )

        await self.patch(f"/api/tasks/{task.id}", json={"title": "renamed"})
        response = await self.patch(f"/api/tasks/{task.id}", json={"status": "completed"})

        response.assert_json(_data_attrs(lambda a: a.where("completed_at", stamp).etc()))

    async def test_update_missing_task_returns_404(self):
        response = await self.patch("/api/tasks/999999", json={"title": "nope"})
        response.assert_status(404)

    # --- destroy ---

    async def test_destroy_deletes_task(self):
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.delete(f"/api/tasks/{task.id}")
        response.assert_no_content()
        self.assertIsNone(await Task.find(task.id))

    async def test_destroy_returns_bodyless_204(self):
        """A 204 must carry no body. A JSON body ({}) sets Content-Length: 0 while
        writing 2 bytes, raising a server-side "Response content longer than
        Content-Length" RuntimeError on every delete. Assert the body is empty."""
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.delete(f"/api/tasks/{task.id}")

        response.assert_no_content()
        assert response.content == b"", f"expected empty 204 body, got {response.content!r}"

    async def test_destroy_missing_task_returns_404(self):
        response = await self.delete("/api/tasks/999999")
        response.assert_status(404)
