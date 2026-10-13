import datetime
import hashlib
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.services.gemini_usage import GeminiUsageReader
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

NOW = datetime.datetime.now(datetime.UTC).isoformat()


def message(identifier="m1", timestamp=NOW, model="gemini-3.8-flash", **counts):
    return {
        "id": identifier,
        "type": "gemini",
        "timestamp": timestamp,
        "model": model,
        "tokens": {
            "input": 1000,
            "cached": 600,
            "output": 50,
            "thoughts": 20,
            "tool": 10,
            "total": 1080,
            **counts,
        },
    }


class TestGeminiProjectUsage(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.storage = self.root / "gemini"
        environment = mock.patch.dict(
            os.environ,
            {
                "KEERA_GEMINI_STORAGE_DIR": str(self.storage),
                "KEERA_CLAUDE_PROJECTS_DIR": str(self.root / "other-provider"),
                "KEERA_CODEX_SESSIONS_DIR": str(self.root / "other-sessions"),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.project = await ProjectFactory.new().create(path=str(self.root / "project"))
        self.agent = await AgentFactory.new().create(project_id=self.project.id, provider="gemini")
        self.reader = GeminiUsageReader()

    def _path(self, name="session-main.jsonl", agent_id=None):
        path = (
            self.storage
            / f"agent-{agent_id or self.agent.id}"
            / ".gemini"
            / "tmp"
            / "project"
            / "chats"
            / name
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _metadata(self, cwd=None):
        return {
            "sessionId": "session",
            "projectHash": hashlib.sha256((cwd or self.project.path).encode()).hexdigest(),
        }

    def _write(self, path, *records, mode="w"):
        with path.open(mode) as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")

    def _read(self, today=None):
        return self.reader.project_usage(
            self.project.id, self.project.path, [self.agent.id], today=today
        )

    async def test_api_reports_cached_thinking_tool_tokens_and_estimated_cost(self):
        self._write(self._path(), self._metadata(), message())
        response = await self.get(f"/api/projects/{self.project.id}/usage")
        response.assert_ok()
        usage = response.json()["data"]["attributes"]
        agent = usage["agents"][str(self.agent.id)]
        self.assertEqual(
            (agent["input"], agent["output"], agent["cache_read"], agent["total"]),
            (410, 70, 600, 1080),
        )
        self.assertEqual(agent["last_model"], "gemini-3.8-flash")
        self.assertAlmostEqual(agent["gemini_estimated_cost_usd"], 0.000615)
        self.assertEqual(usage["today"]["total"], 1080)
        self.assertEqual(
            usage["today"]["gemini_estimated_cost_usd"], agent["gemini_estimated_cost_usd"]
        )
        self.assertIsNone(usage["limits"])

    async def test_snapshot_migration_repeated_updates_and_resume_are_deduplicated(self):
        snapshot = self._path("session-main.json")
        snapshot.write_text(json.dumps({**self._metadata(), "messages": [message()]}))
        path = self._path()
        self._write(path, self._metadata(), message(), message())
        self.assertEqual(self._read().today.total, 1080)
        self._write(path, message("m2"), mode="a")
        self.assertEqual(self._read().today.total, 2160)
        self.assertEqual(self._read().today.total, 2160)

    async def test_partial_lines_and_invalid_records_do_not_hide_valid_usage(self):
        path = self._path()
        self._write(path, self._metadata(), message(), {"type": "gemini", "tokens": {}})
        second = json.dumps(message("m2")) + "\n"
        with path.open("a") as handle:
            handle.write("invalid json\n" + second[:50])
        self.assertEqual(self._read().today.total, 1080)
        with path.open("a") as handle:
            handle.write(second[50:])
        self.assertEqual(self._read().today.total, 2160)

    async def test_rewrite_truncation_and_deletion_update_cached_usage(self):
        path = self._path()
        self._write(path, self._metadata(), message())
        self.assertEqual(self._read().today.total, 1080)
        self._write(path, self._metadata(), message(input=2000, cached=1600))
        self.assertEqual(self._read().today.total, 2080)
        self._write(path, self._metadata())
        self.assertEqual(self._read().today.total, 0)
        path.unlink()
        self.assertEqual(self._read().agents, {})

    async def test_project_hash_and_agent_ownership_exclude_other_projects(self):
        self._write(self._path("session-wrong.jsonl"), self._metadata("/elsewhere"), message())
        self._write(self._path(agent_id=self.agent.id + 9999), self._metadata(), message())
        self.assertEqual(self._read().today.total, 0)
        cwd = f"{self.project.path}/.claude/worktrees/agent-{self.agent.id}"
        self._write(self._path(), self._metadata(cwd), message())
        self.assertEqual(self._read().today.total, 1080)

    async def test_historical_usage_and_price_change(self):
        self._write(
            self._path(),
            self._metadata(),
            message(timestamp="2026-12-31T12:00:00Z"),
            message("m2", timestamp="2027-01-01T12:00:00Z"),
        )
        usage = self._read(today=datetime.date(2027, 1, 1))
        self.assertEqual(usage.today.total, 1080)
        self.assertEqual(usage.agents[self.agent.id].tokens.total, 2160)
        self.assertAlmostEqual(usage.gemini_estimated_cost_usd, 0.00123)
        self.assertAlmostEqual(usage.agents[self.agent.id].gemini_estimated_cost_usd, 0.001845)

    async def test_tool_prompt_details_already_in_total_are_not_double_counted(self):
        self._write(self._path(), self._metadata(), message(total=1070))
        self.assertEqual(self._read().today.total, 1070)
        self.assertEqual(self._read().today.input, 400)

    async def test_unknown_models_keep_tokens_without_inventing_cost(self):
        self._write(self._path(), self._metadata(), message(), message("m2", model="custom-gemini"))
        usage = self._read()
        self.assertEqual(usage.today.total, 2160)
        self.assertIsNone(usage.gemini_estimated_cost_usd)
        self.assertNotIn("gemini_estimated_cost_usd", usage.agents[self.agent.id].to_dict())

    async def test_subagent_sessions_and_legacy_snapshot_rewrites(self):
        snapshot = self._path("session-main.json")
        snapshot.write_text(json.dumps({**self._metadata(), "messages": [message()]}))
        self.assertEqual(self._read().today.total, 1080)
        snapshot.write_text("{")
        self.assertEqual(self._read().today.total, 1080)
        snapshot.write_text(
            json.dumps({**self._metadata(), "messages": [message(), message("m2")]})
        )
        self._write(self._path("parent/subagent.jsonl"), self._metadata(), message("m3"))
        self.assertEqual(self._read().today.total, 3240)

    async def test_non_numeric_negative_and_boolean_counts_are_ignored(self):
        self._write(
            self._path(),
            self._metadata(),
            message(input=-1, cached=100, output="5", thoughts=True, tool=None),
        )
        self.assertEqual(self._read().today.total, 0)
