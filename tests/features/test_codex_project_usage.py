import datetime
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.services.claude_usage import AgentUsage, ProjectUsage, Tokens
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

NOW = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
LAST_YEAR = "2020-01-01T12:00:00.000Z"


def session_meta(cwd: str) -> str:
    return json.dumps(
        {"timestamp": NOW, "type": "session_meta", "payload": {"id": "s", "cwd": cwd}}
    )


def turn_context(model: str) -> str:
    return json.dumps({"timestamp": NOW, "type": "turn_context", "payload": {"model": model}})


def token_count(
    input_tokens: int, cached: int, output: int, timestamp: str = NOW, info: bool = True
) -> str:
    total = {
        "input_tokens": input_tokens,
        "cached_input_tokens": cached,
        "cache_write_input_tokens": 0,
        "output_tokens": output,
        "reasoning_output_tokens": 0,
        "total_tokens": input_tokens + output,
    }
    return json.dumps(
        {
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {"total_token_usage": total, "last_token_usage": total} if info else None,
                "rate_limits": None,
            },
        }
    )


class TestCodexProjectUsage(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(os.path.realpath(self.tmp.name))
        self.sessions = root / "codex-sessions"
        env = mock.patch.dict(
            os.environ,
            {
                "KEERA_CLAUDE_PROJECTS_DIR": str(root / "claude-projects"),
                "KEERA_CODEX_SESSIONS_DIR": str(self.sessions),
            },
        )
        env.start()
        self.addCleanup(env.stop)

        self.project_path = str(root / "code" / "keera")
        self.project = await ProjectFactory.new().create(path=self.project_path)

    def _rollout(self, name: str, *lines: str, mode: str = "w") -> Path:
        path = self.sessions / "2026" / "09" / "26" / f"rollout-{name}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open(mode) as handle:
            handle.write("".join(line + "\n" for line in lines))
        return path

    def _agent_cwd(self, agent_id: int) -> str:
        return f"{self.project_path}/.claude/worktrees/agent-{agent_id}"

    async def _usage(self) -> dict:
        response = await self.get(f"/api/projects/{self.project.id}/usage")
        response.assert_ok()
        return response.json()["data"]["attributes"]

    async def test_counts_each_agents_growth_once_and_splits_cached_input(self):
        self._rollout(
            "a",
            session_meta(self._agent_cwd(7)),
            turn_context("gpt-5.6"),
            token_count(1000, 600, 50),
            token_count(1000, 600, 50),  # repeated on a rate-limit update
            token_count(2500, 2000, 80),
        )

        agent = (await self._usage())["agents"]["7"]

        self.assertEqual(
            {k: v for k, v in agent.items() if k != "last_used_at"},
            {
                "input": 500,
                "output": 80,
                "cache_creation": 0,
                "cache_read": 2000,
                "total": 2580,
                "last_model": "gpt-5.6",
            },
        )

    async def test_only_matches_the_project_and_its_agent_worktrees(self):
        self._rollout("project", session_meta(self.project_path), token_count(100, 0, 10))
        self._rollout("other", session_meta("/elsewhere"), token_count(900, 0, 90))
        self._rollout("sibling", session_meta(self.project_path + "-copy"), token_count(900, 0, 90))
        self._rollout("no-meta", token_count(900, 0, 90))

        usage = await self._usage()

        self.assertEqual(usage["agents"], {})
        self.assertEqual(usage["today"]["total"], 110)

    async def test_today_excludes_older_usage(self):
        self._rollout(
            "a",
            session_meta(self._agent_cwd(3)),
            token_count(100, 0, 10, timestamp=LAST_YEAR),
            token_count(300, 0, 20),
            token_count(300, 0, 20, info=False),
        )

        usage = await self._usage()

        self.assertEqual(usage["today"]["total"], 210)
        self.assertEqual(usage["agents"]["3"]["total"], 320)

    async def test_reads_only_complete_appended_events(self):
        path = self._rollout("a", session_meta(self._agent_cwd(4)), token_count(100, 0, 10))
        self.assertEqual((await self._usage())["agents"]["4"]["total"], 110)

        self._rollout("a", token_count(400, 0, 40), mode="a")
        with path.open("a") as handle:
            handle.write(token_count(900, 0, 90)[:40])  # a half-written line

        self.assertEqual((await self._usage())["agents"]["4"]["total"], 440)

    async def test_merge_sums_tokens_and_keeps_the_latest_model(self):
        claude = ProjectUsage(
            id=1,
            today=Tokens(input=1),
            agents={4: AgentUsage(Tokens(output=5), "claude-opus-5", "2026-09-26T10:00:00+00:00")},
        )
        codex = ProjectUsage(
            id=1,
            today=Tokens(input=2),
            agents={
                4: AgentUsage(Tokens(output=7), "gpt-5.6", "2026-09-26T11:00:00+00:00"),
                9: AgentUsage(Tokens(input=3), "gpt-5.6", "2026-09-26T09:00:00+00:00"),
            },
        )

        merged = claude.merge(codex)

        self.assertEqual(merged.today.input, 3)
        self.assertEqual(merged.agents[4].tokens.output, 12)
        self.assertEqual(merged.agents[4].last_model, "gpt-5.6")
        self.assertEqual(merged.agents[9].tokens.input, 3)
