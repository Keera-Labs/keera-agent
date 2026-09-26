import datetime
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.services.claude_usage import encode_cwd
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

NOW = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
LAST_YEAR = "2020-01-01T12:00:00.000Z"


def assistant_line(
    message_id: str,
    input_tokens: int = 10,
    output_tokens: int = 5,
    cache_creation: int = 100,
    cache_read: int = 1000,
    model: str = "claude-opus-5",
    timestamp: str = NOW,
    request_id: str | None = None,
) -> str:
    return json.dumps(
        {
            "type": "assistant",
            "timestamp": timestamp,
            "requestId": request_id or f"req_{message_id}",
            "message": {
                "id": message_id,
                "model": model,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_creation_input_tokens": cache_creation,
                    "cache_read_input_tokens": cache_read,
                },
            },
        }
    )


class TestProjectUsageController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(os.path.realpath(self.tmp.name))
        self.transcripts = root / "claude-projects"
        self.transcripts.mkdir()
        env = mock.patch.dict(
            os.environ,
            {
                "KEERA_CLAUDE_PROJECTS_DIR": str(self.transcripts),
                "KEERA_CODEX_SESSIONS_DIR": str(root / "codex-sessions"),
            },
        )
        env.start()
        self.addCleanup(env.stop)

        self.project_path = str(root / "code" / "keera")
        self.project = await ProjectFactory.new().create(path=self.project_path)

    def _write(self, cwd: str, filename: str, *lines: str, mode: str = "w") -> Path:
        path = self.transcripts / encode_cwd(cwd) / filename
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

    async def test_sums_each_agent_and_counts_a_streamed_message_once(self):
        self._write(
            self._agent_cwd(7),
            "s1.jsonl",
            assistant_line("m1"),
            assistant_line("m1"),
            assistant_line("m2", input_tokens=1, output_tokens=2, cache_creation=3, cache_read=4),
        )
        self._write(self._agent_cwd(8), "s1.jsonl", assistant_line("m3", model="claude-sonnet-5"))

        usage = await self._usage()

        self.assertEqual(
            {k: v for k, v in usage["agents"]["7"].items() if k != "last_used_at"},
            {
                "input": 11,
                "output": 7,
                "cache_creation": 103,
                "cache_read": 1004,
                "total": 1125,
                "last_model": "claude-opus-5",
            },
        )
        self.assertEqual(usage["agents"]["8"]["total"], 1115)
        self.assertEqual(usage["agents"]["8"]["last_model"], "claude-sonnet-5")

    async def test_messages_copied_into_a_resumed_session_are_not_double_counted(self):
        self._write(self._agent_cwd(7), "first.jsonl", assistant_line("m1"))
        self._write(self._agent_cwd(7), "resumed.jsonl", assistant_line("m1"), assistant_line("m2"))
        self._write(self._agent_cwd(7), "first/subagents/agent-a.jsonl", assistant_line("m3"))

        usage = await self._usage()

        self.assertEqual(usage["agents"]["7"]["total"], 3 * 1115)

    async def test_today_totals_the_project_session_and_agents_but_not_earlier_days(self):
        self._write(self.project_path, "pm.jsonl", assistant_line("m1"))
        self._write(
            self._agent_cwd(7),
            "s1.jsonl",
            assistant_line("m2"),
            assistant_line("m3", timestamp=LAST_YEAR),
        )

        usage = await self._usage()

        self.assertEqual(usage["today"]["total"], 2 * 1115)
        self.assertEqual(usage["agents"]["7"]["total"], 2 * 1115)
        self.assertEqual(set(usage["agents"]), {"7"})

    async def test_ignores_other_projects_and_non_agent_worktrees(self):
        self._write(self.project_path + "-2", "s.jsonl", assistant_line("m1"))
        self._write(
            self.project_path + "-2/.claude/worktrees/agent-9", "s.jsonl", assistant_line("m2")
        )
        self._write(
            f"{self.project_path}/.claude/worktrees/feature", "s.jsonl", assistant_line("m3")
        )

        usage = await self._usage()

        self.assertEqual(usage["agents"], {})
        self.assertEqual(usage["today"]["total"], 0)

    async def test_picks_up_appended_lines_and_waits_for_a_partial_line(self):
        path = self._write(self._agent_cwd(7), "s1.jsonl", assistant_line("m1"))
        self.assertEqual((await self._usage())["agents"]["7"]["total"], 1115)

        partial = assistant_line("m3")
        with path.open("a") as handle:
            handle.write(assistant_line("m2") + "\n" + partial[:20])
        self.assertEqual((await self._usage())["agents"]["7"]["total"], 2 * 1115)

        with path.open("a") as handle:
            handle.write(partial[20:] + "\n")
        self.assertEqual((await self._usage())["agents"]["7"]["total"], 3 * 1115)

    async def test_skips_malformed_and_non_assistant_lines(self):
        self._write(
            self._agent_cwd(7),
            "s1.jsonl",
            "{not json",
            json.dumps({"type": "user", "timestamp": NOW, "message": {"id": "u1", "usage": {}}}),
            assistant_line("m1"),
        )

        usage = await self._usage()

        self.assertEqual(usage["agents"]["7"]["total"], 1115)

    async def test_empty_when_there_are_no_transcripts(self):
        usage = await self._usage()

        self.assertEqual(usage["agents"], {})
        self.assertEqual(usage["today"]["total"], 0)

    async def test_unknown_project_is_not_found(self):
        response = await self.get("/api/projects/999999/usage")

        response.assert_status(404)
