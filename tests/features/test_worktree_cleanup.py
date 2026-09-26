"""Safe agent-worktree cleanup, exercised on throwaway repos with a local bare remote."""

import os
import subprocess
import threading
from pathlib import Path

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.console.worktrees_prune_command import WorktreesPruneCommand
from app.services import worktree_cleanup as wc
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase


def make_repo(test_case) -> GitTestRepo:
    repo = GitTestRepo(test_case).init()
    repo.write("README.md", "root\n")
    repo.commit_all("init")
    repo.add_bare_remote()
    repo.git("push", "-q", "origin", "main")
    return repo


def add_worktree(
    repo: GitTestRepo, name: str, branch: str | None = None, parent=".claude/worktrees"
) -> Path:
    path = repo.root / parent / name
    repo.git("worktree", "add", "-q", "-b", branch or f"worktree-{name}", str(path))
    return path


def commit_in(repo: GitTestRepo, path: Path, filename: str = "work.txt") -> None:
    (path / filename).write_text("agent work\n")
    repo.git("add", "-A", cwd=path)
    repo.git("commit", "-q", "-m", "agent work", cwd=path)


def lock(repo: GitTestRepo, path: Path, reason: str) -> None:
    repo.git("worktree", "lock", "--reason", reason, str(path))


def dead_pid() -> int:
    proc = subprocess.Popen(["true"])
    proc.wait()
    return proc.pid


def branches(repo: GitTestRepo) -> list[str]:
    return repo.git("branch", "--format=%(refname:short)").split()


class TestCleanupAgentWorktree(TestCase):
    def setUp(self):
        self.repo = make_repo(self)
        self.root = str(self.repo.root)

    def test_removes_clean_worktree_and_its_branch(self):
        path = add_worktree(self.repo, "agent-7")

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertTrue(result["removed"])
        self.assertTrue(result["branch_deleted"])
        self.assertIsNone(result["error"])
        self.assertFalse(path.exists())
        self.assertNotIn("worktree-agent-7", branches(self.repo))

    def test_keeps_dirty_worktree(self):
        path = add_worktree(self.repo, "agent-7")
        (path / "notes.txt").write_text("unsaved\n")
        (path / "README.md").write_text("edited\n")

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertFalse(result["removed"])
        self.assertIn("2 uncommitted/untracked files", result["error"])
        self.assertTrue((path / "notes.txt").exists())
        self.assertIn("worktree-agent-7", branches(self.repo))

    def test_keeps_worktree_with_unpushed_commits(self):
        path = add_worktree(self.repo, "agent-7")
        commit_in(self.repo, path)

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertFalse(result["removed"])
        self.assertIn("1 unpushed commits", result["error"])
        self.assertTrue(path.exists())

    def test_removes_squash_merged_branch_whose_tip_is_on_the_remote(self):
        path = add_worktree(self.repo, "agent-7", branch="task/feature")
        commit_in(self.repo, path)
        self.repo.git("push", "-q", "origin", "task/feature", cwd=path)

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertTrue(result["removed"])
        self.assertEqual(result["branch"], "task/feature")
        self.assertNotIn("task/feature", branches(self.repo))
        self.assertIn("task/feature", self.repo.git("ls-remote", "--heads", "origin"))

    def test_finds_worktree_under_dot_worktrees_too(self):
        path = add_worktree(self.repo, "agent-7", parent=".worktrees")

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertTrue(result["removed"])
        self.assertFalse(path.exists())

    def test_never_deletes_a_protected_branch(self):
        self.repo.git("branch", "dev")
        path = self.repo.root / ".claude/worktrees/agent-7"
        self.repo.git("worktree", "add", "-q", str(path), "dev")

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertTrue(result["removed"])
        self.assertFalse(result["branch_deleted"])
        self.assertIn("dev", branches(self.repo))

    def test_skips_worktree_locked_by_a_running_process(self):
        path = add_worktree(self.repo, "agent-7")
        lock(self.repo, path, f"claude session agent-7 (pid {os.getpid()} start now)")

        [result] = wc.cleanup_agent_worktree(self.root, 7, wait=0.2)

        self.assertFalse(result["removed"])
        self.assertIn(f"locked by running pid {os.getpid()}", result["error"])
        self.assertTrue(path.exists())

    def test_skips_worktree_locked_without_a_pid(self):
        path = add_worktree(self.repo, "agent-7")
        lock(self.repo, path, "kept on purpose")

        [result] = wc.cleanup_agent_worktree(self.root, 7)

        self.assertIn("locked: kept on purpose", result["error"])
        self.assertTrue(path.exists())

    def test_lifts_a_stale_lock_whose_process_is_gone(self):
        path = add_worktree(self.repo, "agent-7")
        lock(self.repo, path, f"claude session agent-7 (pid {dead_pid()} start then)")

        [result] = wc.cleanup_agent_worktree(self.root, 7, wait=0)

        self.assertTrue(result["removed"])
        self.assertFalse(path.exists())

    def test_waits_for_the_lock_holder_to_exit(self):
        path = add_worktree(self.repo, "agent-7")
        holder = subprocess.Popen(["sleep", "0.5"])
        # Reap it as soon as it exits; an unreaped zombie still answers kill(pid, 0).
        threading.Thread(target=holder.wait, daemon=True).start()
        lock(self.repo, path, f"claude session agent-7 (pid {holder.pid} start now)")

        [result] = wc.cleanup_agent_worktree(self.root, 7, wait=5)

        self.assertTrue(result["removed"], result)

    def test_deletes_a_leftover_default_branch_only_when_safe(self):
        self.repo.git("branch", "worktree-agent-7")
        self.repo.git("checkout", "-q", "-b", "worktree-agent-8")
        self.repo.write("x.txt", "x")
        self.repo.commit_all("unpushed work")
        self.repo.git("checkout", "-q", "main")

        [safe] = wc.cleanup_agent_worktree(self.root, 7)
        [kept] = wc.cleanup_agent_worktree(self.root, 8)

        self.assertTrue(safe["branch_deleted"])
        self.assertFalse(kept["branch_deleted"])
        self.assertIn("unpushed commits", kept["error"])
        self.assertIn("worktree-agent-8", branches(self.repo))

    def test_no_worktree_is_a_no_op(self):
        self.assertEqual(wc.cleanup_agent_worktree(self.root, 7), [])

    def test_git_failure_is_reported_not_raised(self):
        results = wc.cleanup_agent_worktree(str(self.repo.base / "missing"), 7)

        self.assertIn("cleanup failed", results[0]["error"])


class TestPrunePlan(TestCase):
    def setUp(self):
        self.repo = make_repo(self)
        self.root = str(self.repo.root)

    def plan(self, live=(), **kwargs):
        kwargs.setdefault("min_age_hours", 0)
        return wc.plan_prune(self.root, set(live), **kwargs)

    def by_path(self, plan):
        return {Path(c.worktree.path).name: c for c in plan.candidates}

    def test_classifies_orphans(self):
        add_worktree(self.repo, "agent-1")
        dirty = add_worktree(self.repo, "agent-2")
        (dirty / "tmp.txt").write_text("x")
        ahead = add_worktree(self.repo, "task-x", parent=".worktrees")
        commit_in(self.repo, ahead)
        add_worktree(self.repo, "agent-3")

        found = self.by_path(self.plan(live={3}))

        self.assertTrue(found["agent-1"].assessment.removable)
        self.assertEqual(found["agent-1"].owner, "gone agent 1")
        self.assertEqual(found["agent-2"].assessment.dirty, 1)
        self.assertFalse(found["agent-2"].assessment.removable)
        self.assertEqual(found["task-x"].assessment.unpushed, 1)
        self.assertFalse(found["task-x"].assessment.removable)
        self.assertIn("owned by a live agent", found["agent-3"].assessment.reasons)

    def test_external_worktrees_need_opt_in(self):
        self.repo.git("worktree", "add", "-q", "-b", "sibling", str(self.repo.base / "sibling"))

        self.assertEqual(self.plan().external, 1)
        self.assertEqual(self.plan().candidates, [])
        self.assertIn("sibling", self.by_path(self.plan(include_external=True)))

    def test_live_agent_worktree_is_skipped_even_when_external_included(self):
        add_worktree(self.repo, "agent-3")

        found = self.by_path(self.plan(live={3}, include_external=True))

        self.assertFalse(found["agent-3"].assessment.removable)

    def test_recently_used_ownerless_worktrees_are_skipped(self):
        add_worktree(self.repo, "agent-1")
        add_worktree(self.repo, "task-x", parent=".worktrees")

        found = self.by_path(self.plan(min_age_hours=24))

        self.assertIn("used within the last 24h", found["task-x"].assessment.reasons)
        self.assertTrue(found["agent-1"].assessment.removable)

    def test_missing_directories_are_listed_separately(self):
        path = add_worktree(self.repo, "agent-1")
        subprocess.run(["rm", "-rf", str(path)], check=True)

        plan = self.plan()

        self.assertEqual([Path(w.path).name for w in plan.missing], ["agent-1"])
        self.assertEqual(plan.candidates, [])


class TestWorktreesPruneCommand(TestCase):
    def setUp(self):
        self.repo = make_repo(self)
        self.clean = add_worktree(self.repo, "agent-1")
        self.dirty = add_worktree(self.repo, "agent-2")
        (self.dirty / "tmp.txt").write_text("x")
        self.command = WorktreesPruneCommand()
        self.output: list[str] = []
        self.command.line = lambda text="", *a, **k: self.output.append(text)

    def run_command(self, dry_run: bool) -> int:
        plan = wc.plan_prune(str(self.repo.root), set(), min_age_hours=0)
        return self.command._run([plan], dry_run)

    def test_dry_run_changes_nothing_and_reports_both_sides(self):
        before = self.repo.git("worktree", "list", "--porcelain")

        status = self.run_command(dry_run=True)

        out = "\n".join(self.output)
        self.assertEqual(status, 0)
        self.assertEqual(self.repo.git("worktree", "list", "--porcelain"), before)
        self.assertIn("WOULD REMOVE", out)
        self.assertIn("SKIP", out)
        self.assertIn("1 uncommitted/untracked files", out)
        self.assertIn("Would remove 1 worktrees", out)
        self.assertIn("skipped 1", out)
        self.assertIn("Dry run: nothing was changed.", out)

    def test_run_removes_only_the_safe_worktree(self):
        status = self.run_command(dry_run=False)

        self.assertEqual(status, 0)
        self.assertFalse(self.clean.exists())
        self.assertTrue((self.dirty / "tmp.txt").exists())
        self.assertIn("Removed 1 worktrees", "\n".join(self.output))


class TestAgentDeleteWorktreeCleanup(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = make_repo(self)
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    async def test_destroy_removes_clean_worktree_and_reports_it(self):
        agent = await AgentFactory.new().create(project_id=self.project.id, session_id=None)
        path = add_worktree(self.repo, f"agent-{agent.id}")

        response = await self.delete(f"/api/agents/{agent.id}")

        response.assert_ok()
        [result] = response.json()["worktree_cleanup"]
        self.assertTrue(result["removed"])
        self.assertFalse(path.exists())

    async def test_destroy_keeps_dirty_worktree_and_surfaces_why(self):
        agent = await AgentFactory.new().create(project_id=self.project.id, session_id=None)
        path = add_worktree(self.repo, f"agent-{agent.id}")
        (path / "wip.txt").write_text("wip")

        response = await self.delete(f"/api/agents/{agent.id}")

        response.assert_ok()
        [result] = response.json()["worktree_cleanup"]
        self.assertFalse(result["removed"])
        self.assertIn("uncommitted", result["error"])
        self.assertTrue((path / "wip.txt").exists())
