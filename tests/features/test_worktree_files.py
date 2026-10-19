import os
import unittest
from types import SimpleNamespace
from unittest import mock

from app.controllers.agent_trigger_controller import ensure_agent_worktree
from app.services.worktree_cleanup import cleanup_agent_worktree
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


class TestCopyWorktreeFilesSymlinks(unittest.TestCase):
    def setUp(self):
        self.repo = GitTestRepo(self).init()
        self.repo.write(".gitignore", ".env\nconfig/\nstorage/\nhome\n")
        self.repo.write("README.md", "tracked\n")
        self.repo.commit_all("initial")
        self.repo.write(".env", "SECRET=1\n")
        self.repo.write("config/app.local.json", "{}")
        self.repo.write("storage/cache/data.db", "db")
        self.outside = self.repo.base / "outside"
        self.outside.mkdir()
        (self.outside / "id_rsa").write_text("private key")
        self.worktree = self.repo.add_worktree(".claude/worktrees/agent-7", "worktree-agent-7")
        logger = mock.patch("app.services.worktree_files.Logger")
        self.logger = logger.start()
        self.addCleanup(logger.stop)

    def copy(self, *patterns: str) -> None:
        copy_worktree_files(self.repo.root, self.worktree, list(patterns))

    def commit_worktree_symlink(self, name: str, target) -> None:
        (self.worktree / name).symlink_to(target)
        self.repo.git("add", "-f", name, cwd=self.worktree)
        self.repo.git("commit", "-q", "-m", f"link {name}", cwd=self.worktree)

    def test_committed_symlink_in_the_worktree_never_redirects_file_writes(self):
        self.commit_worktree_symlink("config", self.outside)

        self.copy("config/*.local.json")

        self.assertFalse((self.outside / "app.local.json").exists())
        self.logger.warning.assert_called_once()

    def test_committed_symlink_in_the_worktree_never_redirects_directory_copies(self):
        self.commit_worktree_symlink("storage", self.outside)

        self.copy("storage")

        self.assertEqual(sorted(p.name for p in self.outside.iterdir()), ["id_rsa"])
        self.logger.warning.assert_called()

    def test_symlinked_directory_out_of_the_project_is_not_read(self):
        (self.repo.root / "home").symlink_to(self.outside, target_is_directory=True)

        self.copy("home/*", "home/id_rsa", "**/id_rsa")

        self.assertFalse((self.worktree / "home").exists())
        self.assertEqual(self.logger.warning.call_count, 2)

    def test_symlink_out_of_the_project_is_copied_as_a_link_not_its_content(self):
        (self.repo.root / ".env").unlink()
        (self.repo.root / ".env").symlink_to(self.outside / "id_rsa")

        self.copy(".env")

        self.assertTrue((self.worktree / ".env").is_symlink())
        self.assertEqual(os.readlink(self.worktree / ".env"), str(self.outside / "id_rsa"))

    def test_symlinks_inside_the_project_keep_working(self):
        (self.repo.root / "config/current.json").symlink_to("app.local.json")
        (self.repo.root / "storage/latest").symlink_to("cache", target_is_directory=True)

        self.copy("config/*.json", "storage")

        self.assertEqual(os.readlink(self.worktree / "config/current.json"), "app.local.json")
        self.assertEqual((self.worktree / "config/current.json").read_text(), "{}")
        self.assertEqual(os.readlink(self.worktree / "storage/latest"), "cache")
        self.assertEqual((self.worktree / "storage/cache/data.db").read_text(), "db")
        self.logger.warning.assert_not_called()


class TestCopiedFilesAndWorktreeCleanup(unittest.TestCase):
    def setUp(self):
        self.repo = GitTestRepo(self).init()
        self.repo.write(".gitignore", ".env\n")
        self.repo.write("README.md", "tracked\n")
        self.repo.commit_all("initial")
        self.repo.write(".env", "SECRET=1\n")
        self.repo.write("notes.txt", "untracked, not ignored\n")
        self.worktree = self.repo.add_worktree(".claude/worktrees/agent-7", "worktree-agent-7")
        logger = mock.patch("app.services.worktree_cleanup.Logger")
        logger.start()
        self.addCleanup(logger.stop)

    def test_gitignored_copies_leave_the_worktree_removable(self):
        copy_worktree_files(self.repo.root, self.worktree, [".env"])

        cleanup_agent_worktree(str(self.repo.root), 7, 0)

        self.assertFalse(self.worktree.exists())

    def test_non_ignored_copies_keep_the_worktree_as_unsaved_work(self):
        copy_worktree_files(self.repo.root, self.worktree, ["notes.txt"])

        cleanup_agent_worktree(str(self.repo.root), 7, 0)

        self.assertTrue((self.worktree / "notes.txt").exists())


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

    def test_gemini_agent_runs_in_worktree_and_preserves_existing_work(self):
        cwd = ensure_agent_worktree(self.agent(provider="gemini"), self.cwd, [".env"])
        self.assertEqual(os.path.realpath(cwd), os.path.realpath(self.worktree))
        (self.worktree / "notes.txt").write_text("saved work")
        self.assertEqual(ensure_agent_worktree(self.agent(provider="gemini"), self.cwd), cwd)
        self.assertEqual((self.worktree / "notes.txt").read_text(), "saved work")
        self.assertEqual((self.worktree / ".env").read_text(), "SECRET=1\n")

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
