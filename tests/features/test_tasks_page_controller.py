"""
Feature tests for tasks_page_controller.

Ensures the Inertia /tasks page serialises tasks with `body` (not the
dropped `description` column) so the frontend never receives None for
the field it actually reads.
"""

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


def _slugify(name: str) -> str:
    import re
    s = name.lower()
    s = re.sub(r'\s+', '-', s)
    s = re.sub(r'[^a-z0-9-]', '', s)
    return s.strip('-')


class TestTasksPageController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.slug = _slugify(self.project.name)

    # ── serialisation shape ───────────────────────────────────────────────────

    async def test_tasks_page_renders_body_not_description(self):
        """_serialize must include `body` and must NOT include a `description` key."""
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.get(
            f"/{self.slug}/tasks",
            headers={"X-Inertia": "true", "X-Inertia-Version": ""},
        )
        self.assertEqual(response.status_code, 200)

        data = response.json()
        tasks = data.get("props", {}).get("tasks", [])
        self.assertEqual(len(tasks), 1)

        t = tasks[0]
        self.assertIn("body", t)
        self.assertNotIn("description", t)
        self.assertEqual(t["body"], task.body)

    async def test_tasks_page_title_falls_back_to_none_when_no_title(self):
        """title field is just t.title; body is separate — no silent None from .description."""
        task = await TaskFactory.new().create(project_id=self.project.id)

        response = await self.get(
            f"/{self.slug}/tasks",
            headers={"X-Inertia": "true", "X-Inertia-Version": ""},
        )
        self.assertEqual(response.status_code, 200)

        tasks = response.json().get("props", {}).get("tasks", [])
        self.assertEqual(len(tasks), 1)
        # title comes from the actual title column — not from the dropped description
        self.assertEqual(tasks[0]["title"], task.title)

    async def test_tasks_page_with_no_tasks_returns_empty_list(self):
        response = await self.get(
            f"/{self.slug}/tasks",
            headers={"X-Inertia": "true", "X-Inertia-Version": ""},
        )
        self.assertEqual(response.status_code, 200)
        tasks = response.json().get("props", {}).get("tasks", [])
        self.assertEqual(tasks, [])

    async def test_tasks_page_unknown_project_returns_empty_tasks(self):
        response = await self.get(
            "/nonexistent-project-slug/tasks",
            headers={"X-Inertia": "true", "X-Inertia-Version": ""},
        )
        # Inertia renders the page even for unknown project slugs (tasks=[])
        self.assertEqual(response.status_code, 200)
        tasks = response.json().get("props", {}).get("tasks", [])
        self.assertEqual(tasks, [])
