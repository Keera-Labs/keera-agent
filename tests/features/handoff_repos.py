import json
import tempfile
from pathlib import Path

from app.services.handoff.transcript import transcript_dir
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.workspace_factory import WorkspaceFactory
from tests.features.git_test_repo import GitTestRepo

SESSION_ID = "0b6c1d52-3c1e-4f43-9d8a-6a2f0e8f1a11"


class HandoffRepos:
    def __init__(self, test_case):
        self.test_case = test_case
        self.repo = GitTestRepo(test_case).init()
        self.repo.write("README.md", "hello\n")
        self.repo.write("app.py", "print('v1')\n")
        self.repo.write(".gitignore", ".env\n")
        self.repo.write(".gitignore", ".env\n")
        self.repo.commit_all("initial")
        self.remote = self.repo.add_bare_remote()
        self.repo.git("push", "-q", "origin", "main")
        config = tempfile.TemporaryDirectory()
        test_case.addCleanup(config.cleanup)
        self.config_dir = str(Path(config.name).resolve())

    async def source_agent(self, **overrides):
        workspace = await WorkspaceFactory.new().create(claude_config_dir=self.config_dir)
        self.project = await ProjectFactory.new().create(
            path=str(self.repo.root), workspace_id=workspace.id
        )
        self.agent = await AgentFactory.new().create(
            project_id=self.project.id, name="Mover", use_worktree=True, **overrides
        )
        self.worktree = self.repo.add_worktree(
            f".claude/worktrees/agent-{self.agent.id}", "task/feature"
        )
        self.repo.write(f".claude/worktrees/agent-{self.agent.id}/committed.py", "done = 1\n")
        self.repo.git("add", "committed.py", cwd=self.worktree)
        self.repo.git("commit", "-q", "-m", "committed work", cwd=self.worktree)
        (self.worktree / "app.py").write_text("print('v2 uncommitted')\n")
        (self.worktree / "notes.md").write_text("untracked notes\n")
        (self.worktree / ".env").write_text("API_KEY=do-not-push\n")
        self.write_transcript(self.worktree)
        return self.agent

    def write_transcript(self, worktree: Path) -> Path:
        directory = transcript_dir(self.config_dir, str(worktree))
        directory.mkdir(parents=True, exist_ok=True)
        entries = [
            {
                "type": "user",
                "cwd": str(worktree),
                "sessionId": SESSION_ID,
                "message": "remember 42",
            },
            {"type": "assistant", "cwd": str(worktree), "message": f"edited {worktree}/app.py"},
        ]
        path = directory / f"{SESSION_ID}.jsonl"
        path.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
        tool_results = directory / SESSION_ID / "tool-results"
        tool_results.mkdir(parents=True, exist_ok=True)
        (tool_results / "out.txt").write_text(f"ran in {worktree}\n")
        return path

    def clone(self, name: str) -> Path:
        target = self.repo.base / name
        self.repo.git("clone", "-q", str(self.remote), str(target), cwd=self.repo.base)
        return target.resolve()
