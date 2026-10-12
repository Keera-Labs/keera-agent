import os
import unittest
from types import SimpleNamespace
from unittest import mock

from app.controllers.agent_trigger_controller import ensure_agent_worktree
from app.services.worktree_files import copy_worktree_files
from tests.features.git_test_repo import GitTestRepo


class TestCopyWorktreeFiles(unittest.TestCase):
    def setUp(self):
        self.repo = GitTestRepo(self).init()
        self.repo.write(".gitignore", ".env*\nconfig/*.local.json\nstorage/\n")
        self.repo.write("README.md", "tracked\n")
        self.repo.commit_all("initial")
        self.repo.write(".env", "SECRET=1\n")
        self.repo.write(".env.local", "LOCAL=1\n")
        self.repo.write("config/app.local.json", "{}")
        self.repo.write("config/local/app.json", '{"nested": true}')
        self.repo.write("storage/cache/data.db", "db")
        self.worktree = self.repo.add_worktree(".claude/worktrees/agent-7", "worktree-agent-7")

    def copy(self, *patterns: str) -> None:
        copy_worktree_files(self.repo.root, self.worktree, list(patterns))

    def test_copies_plain_files_and_expands_globs(self):
        self.copy(".env*", "config/*.local.json")

        self.assertEqual((self.worktree / ".env").read_text(), "SECRET=1\n")
        self.assertEqual((self.worktree / ".env.local").read_text(), "LOCAL=1\n")
        self.assertEqual((self.worktree / "config/app.local.json").read_text(), "{}")

    def test_creates_parent_directories_for_nested_paths(self):
        self.copy("config/local/app.json")

        self.assertEqual((self.worktree / "config/local/app.json").read_text(), '{"nested": true}')

    def test_copies_directories_recursively(self):
        self.copy("storage")

        self.assertEqual((self.worktree / "storage/cache/data.db").read_text(), "db")

    def test_missing_files_and_empty_globs_are_skipped(self):
        self.copy("missing.env", "nothing/*.json", ".env")

        self.assertTrue((self.worktree / ".env").exists())
        self.assertFalse((self.worktree / "missing.env").exists())

    def test_existing_worktree_files_are_never_overwritten(self):
        self.repo.write("README.md", "changed in main checkout\n")
        (self.worktree / ".env").write_text("WORKTREE=1\n")
        (self.worktree / "storage").mkdir()
        (self.worktree / "storage/keep.txt").write_text("mine")

        self.copy("README.md", ".env", "storage")

        self.assertEqual((self.worktree / "README.md").read_text(), "tracked\n")
        self.assertEqual((self.worktree / ".env").read_text(), "WORKTREE=1\n")
        self.assertEqual((self.worktree / "storage/keep.txt").read_text(), "mine")
        self.assertEqual((self.worktree / "storage/cache/data.db").read_text(), "db")

    def test_git_metadata_and_agent_worktrees_are_never_copied(self):
        self.copy("*", ".claude")

        self.assertFalse((self.worktree / ".claude/worktrees").exists())
        self.assertTrue((self.worktree / ".git").is_file())

    def test_copy_failures_are_logged_and_do_not_stop_other_paths(self):
        with (
            mock.patch(
                "app.services.worktree_files.shutil.copy2", side_effect=[OSError("boom"), None]
            ),
            mock.patch("app.services.worktree_files.Logger") as logger,
        ):
            self.copy(".env", ".env.local")

        logger.warning.assert_called_once()
        self.assertIn(".env", logger.warning.call_args.args[0])


class TestEnsureAgentWorktree(unittest.TestCase):
    def setUp(self):
        self.repo = GitTestRepo(self).init()
        self.repo.write(".gitignore", ".env\n")
        self.repo.write("README.md", "tracked\n")
        self.repo.commit_all("initial")
        self.repo.write(".env", "SECRET=1\n")
        self.cwd = str(self.repo.root)
        self.worktree = self.repo.root / ".claude/worktrees/agent-5"

    def agent(self, provider="claude", use_worktree=True):
        return SimpleNamespace(id=5, provider=provider, use_worktree=use_worktree)

    def test_claude_agent_without_paths_leaves_worktree_creation_to_the_cli(self):
        self.assertEqual(ensure_agent_worktree(self.agent(), self.cwd, []), self.cwd)
        self.assertEqual(ensure_agent_worktree(self.agent(), self.cwd, None), self.cwd)

        self.assertFalse(self.worktree.exists())

    def test_claude_agent_with_paths_gets_a_prepared_worktree(self):
        cwd = ensure_agent_worktree(self.agent(), self.cwd, [".env"])

        self.assertEqual(cwd, self.cwd)
        self.assertEqual((self.worktree / ".env").read_text(), "SECRET=1\n")
        branch = self.repo.git("branch", "--show-current", cwd=self.worktree).strip()
        self.assertEqual(branch, "worktree-agent-5")

    def test_codex_agent_runs_in_its_worktree_with_copied_files(self):
        cwd = ensure_agent_worktree(self.agent(provider="codex"), self.cwd, [".env"])

        self.assertEqual(os.path.realpath(cwd), os.path.realpath(self.worktree))
        self.assertTrue((self.worktree / ".env").exists())

    def test_reusing_an_existing_worktree_tops_up_missing_files(self):
        ensure_agent_worktree(self.agent(), self.cwd, [])
        self.repo.add_worktree(".claude/worktrees/agent-5", "worktree-agent-5")
        (self.worktree / "notes.txt").write_text("agent work")

        ensure_agent_worktree(self.agent(), self.cwd, [".env"])
        ensure_agent_worktree(self.agent(), self.cwd, [".env"])

        self.assertEqual((self.worktree / "notes.txt").read_text(), "agent work")
        self.assertTrue((self.worktree / ".env").exists())

    def test_agent_without_worktree_is_untouched(self):
        cwd = ensure_agent_worktree(self.agent(use_worktree=False), self.cwd, [".env"])

        self.assertEqual(cwd, self.cwd)
        self.assertFalse(self.worktree.exists())

    def test_worktree_creation_failure_falls_back_to_the_cli_for_claude(self):
        with (
            mock.patch(
                "app.controllers.agent_trigger_controller._create_agent_worktree",
                side_effect=RuntimeError("git failed"),
            ),
            mock.patch("app.controllers.agent_trigger_controller.Logger") as logger,
        ):
            self.assertEqual(ensure_agent_worktree(self.agent(), self.cwd, [".env"]), self.cwd)

        logger.warning.assert_called_once()

    def test_codex_worktree_creation_failure_still_raises(self):
        with mock.patch(
            "app.controllers.agent_trigger_controller._create_agent_worktree",
            side_effect=RuntimeError("git failed"),
        ):
            with self.assertRaises(RuntimeError):
                ensure_agent_worktree(self.agent(provider="codex"), self.cwd, [".env"])
