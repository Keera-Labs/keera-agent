from bootstrap.application import app
from fastapi_startkit.fastapi.testing import HttpTestCase
from app.models.Project import Project


class TestProjects(HttpTestCase):
    def get_application(self):
        return app

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await Project.where("id", ">", 0).delete()

    async def test_list_projects_returns_empty_list_initially(self):
        response = await self.get("/api/projects")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    async def test_create_project(self):
        response = await self.post("/api/projects", json={
            "name": "my-project",
            "path": "~/code/my-project",
            "language": "Python",
            "create_dir": True,
        })
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["name"], "my-project")
        self.assertEqual(data["path"], "~/code/my-project")
        self.assertEqual(data["language"], "Python")
        self.assertIn("id", data)

    async def test_create_project_returns_422_when_path_missing(self):
        response = await self.post("/api/projects", json={
            "name": "no-dir-project",
            "path": "~/code/nonexistent-test-dir-xyzzy",
            "language": "Python",
        })
        self.assertEqual(response.status_code, 422)
        data = response.json()
        self.assertEqual(data["error"], "path_not_found")
        self.assertIn("expanded", data)

    async def test_created_project_appears_in_list(self):
        await self.post("/api/projects", json={
            "name": "listed-project",
            "path": "~/code/listed-project",
            "language": "TypeScript",
            "create_dir": True,
        })
        response = await self.get("/api/projects")
        self.assertEqual(response.status_code, 200)
        names = [p["name"] for p in response.json()]
        self.assertIn("listed-project", names)

    async def test_create_project_requires_name(self):
        response = await self.post("/api/projects", json={
            "path": "~/code/no-name",
            "language": "Go",
        })
        self.assertEqual(response.status_code, 422)

    async def test_create_project_requires_path(self):
        response = await self.post("/api/projects", json={
            "name": "no-path-project",
            "language": "Go",
        })
        self.assertEqual(response.status_code, 422)

    async def test_duplicate_project_name_returns_conflict(self):
        payload = {"name": "dup-project", "path": "~/code/dup", "language": "Rust", "create_dir": True}
        await self.post("/api/projects", json=payload)
        response = await self.post("/api/projects", json=payload)
        self.assertEqual(response.status_code, 409)
