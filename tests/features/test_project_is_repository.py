"""
Feature tests for the `is_repository` ensure-once behavior on agent launch.

`is_repository` means "we have already ensured this directory is a git repo",
so it gates the (potentially init-ing) git check to run at most once. These
tests drive the real `_ensure_repo_once` helper that `terminal_ws` calls on
launch, rather than re-implementing its branch inline.
"""

import subprocess
import tempfile
from unittest.mock import patch

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.controllers import terminal_controller
from app.controllers.terminal_controller import (
    _ensure_git_repo,
    _ensure_repo_once,
    _is_git_repo,
)
from app.models.Project import Project
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase


class TestGitRepoHelpers(TestCase, DatabaseTransaction):
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


class TestEnsureRepoOnce(TestCase, DatabaseTransaction):
    async def test_project_defaults_to_not_repository(self):
        project = await ProjectFactory.new().create()
        fresh = await Project.find(project.id)
        self.assertFalse(bool(fresh.is_repository))

    async def test_first_launch_inits_repo_and_sets_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = await ProjectFactory.new().create(path=tmp)
            self.assertFalse(bool(project.is_repository))

            await _ensure_repo_once(project, tmp)

            self.assertTrue(_is_git_repo(tmp))  # init ran
            fresh = await Project.find(project.id)
            self.assertTrue(bool(fresh.is_repository))  # flag persisted

    async def test_later_launch_skips_git_check_entirely(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = await ProjectFactory.new().create(path=tmp, is_repository=True)

            with patch.object(terminal_controller, "_ensure_git_repo") as ensure:
                await _ensure_repo_once(project, tmp)

            ensure.assert_not_called()  # no redundant ensure/init on later launch

    async def test_first_launch_ensures_exactly_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = await ProjectFactory.new().create(path=tmp)

            with patch.object(terminal_controller, "_ensure_git_repo") as ensure:
                await _ensure_repo_once(project, tmp)

            ensure.assert_called_once_with(tmp)

    async def test_flag_not_set_when_ensure_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = await ProjectFactory.new().create(path=tmp)

            with patch.object(
                terminal_controller,
                "_ensure_git_repo",
                side_effect=RuntimeError("git init failed"),
            ):
                with self.assertRaises(RuntimeError):
                    await _ensure_repo_once(project, tmp)

            fresh = await Project.find(project.id)
            self.assertFalse(bool(fresh.is_repository))  # retried next launch
