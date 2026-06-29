"""
Feature tests for the `is_repository` detection on first agent launch.

Covers the git-repo helpers in terminal_controller and the idempotent
persistence of `is_repository` on the Project model.
"""
import subprocess
import tempfile

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers.terminal_controller import _ensure_git_repo, _is_git_repo
from app.models.Project import Project
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestProjectIsRepository(TestCase, DatabaseTransaction):
    def test_is_git_repo_false_for_plain_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(_is_git_repo(tmp))

    def test_is_git_repo_true_after_init(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["git", "-C", tmp, "init"], capture_output=True)
            self.assertTrue(_is_git_repo(tmp))

    def test_ensure_git_repo_initializes_plain_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(_is_git_repo(tmp))
            _ensure_git_repo(tmp)
            self.assertTrue(_is_git_repo(tmp))

    async def test_project_defaults_to_not_repository(self):
        project = await ProjectFactory.new().create()
        fresh = await Project.find(project.id)
        self.assertFalse(bool(fresh.is_repository))

    async def test_is_repository_persists_once_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["git", "-C", tmp, "init"], capture_output=True)
            project = await ProjectFactory.new().create(path=tmp)

            self.assertFalse(bool(project.is_repository))
            if not project.is_repository and _is_git_repo(tmp):
                await Project.where("id", project.id).update({"is_repository": True})

            fresh = await Project.find(project.id)
            self.assertTrue(bool(fresh.is_repository))
