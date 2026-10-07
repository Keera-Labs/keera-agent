import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

from app.statusline import keera_statusline as statusline

SCRIPT = Path(statusline.__file__)

PAYLOAD = {
    "session_id": "abc",
    "model": {"id": "claude-opus-5", "display_name": "Opus"},
    "workspace": {"current_dir": "/nonexistent"},
    "context_window": {"used_percentage": 8, "context_window_size": 200000},
    "rate_limits": {
        "five_hour": {"used_percentage": 23.5, "resets_at": 1738425600},
        "seven_day": {"used_percentage": 41.2, "resets_at": 1738857600},
    },
}


class _Collector(BaseHTTPRequestHandler):
    bodies: list = []

    def do_POST(self):
        length = int(self.headers["Content-Length"])
        _Collector.bodies.append(json.loads(self.rfile.read(length)))
        self.send_response(201)
        self.end_headers()

    def log_message(self, *args):
        pass


class TestKeeraStatusline(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)

    def _user_statusline(self, command: str, directory: str | None = None) -> None:
        settings = Path(directory or self.home.name) / ".claude" / "settings.json"
        settings.parent.mkdir(parents=True, exist_ok=True)
        settings.write_text(json.dumps({"statusLine": {"type": "command", "command": command}}))

    def _run(self, payload: dict | str, url: str | None = None, agent_id: str | None = "7"):
        env = {**os.environ, "HOME": self.home.name}
        env.pop(statusline.AGENT_ID_ENV, None)
        if agent_id:
            env[statusline.AGENT_ID_ENV] = agent_id
        stdin = payload if isinstance(payload, str) else json.dumps(payload)
        args = [sys.executable, str(SCRIPT)] + ([url] if url else [])
        return subprocess.run(
            args, input=stdin, capture_output=True, text=True, env=env, timeout=10
        )

    def test_report_body_maps_the_statusline_payload(self):
        self.assertEqual(
            statusline.report_body(7, PAYLOAD),
            {
                "agent_id": 7,
                "session_id": "abc",
                "model": "claude-opus-5",
                "context_used_percentage": 8,
                "context_window_size": 200000,
                "five_hour_used_percentage": 23.5,
                "five_hour_resets_at": 1738425600,
                "seven_day_used_percentage": 41.2,
                "seven_day_resets_at": 1738857600,
            },
        )

    def test_report_body_tolerates_missing_sections(self):
        body = statusline.report_body(7, {"rate_limits": {"five_hour": None}})

        self.assertIsNone(body["five_hour_used_percentage"])
        self.assertIsNone(body["context_used_percentage"])

    def test_chains_to_the_user_statusline_with_the_same_stdin(self):
        self._user_statusline("cat")

        result = self._run(PAYLOAD)

        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), PAYLOAD)

    @mock.patch.dict(os.environ)
    def test_resolves_the_statusline_by_claude_settings_precedence(self):
        os.environ["HOME"] = self.home.name
        project = Path(self.home.name) / "project"
        self._user_statusline("echo user")
        self._user_statusline(f"python {statusline.MARKER}.py", str(project))
        local = project / ".claude" / "settings.local.json"
        local.write_text(json.dumps({"statusLine": {"type": "command", "command": "echo local"}}))

        self.assertEqual(statusline.user_statusline_command(str(project)), "echo local")

        local.unlink()
        # Keera's own statusline is never chained to; the next level down is used.
        self.assertEqual(statusline.user_statusline_command(str(project)), "echo user")

    def test_prints_a_compact_summary_without_a_user_statusline(self):
        result = self._run(PAYLOAD)

        self.assertEqual(result.stdout, "5h 24% · wk 41% · ctx 8%")

    def test_never_fails_on_bad_input_or_an_unreachable_server(self):
        self._user_statusline("exit 3")

        result = self._run("not json", url="http://127.0.0.1:9/api/agent-usage-reports")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_posts_the_report_for_the_agent(self):
        _Collector.bodies = []
        server = HTTPServer(("127.0.0.1", 0), _Collector)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/api/agent-usage-reports"

        self._run(PAYLOAD, url=url, agent_id="42")
        self._run(PAYLOAD, url=url, agent_id=None)

        self.assertEqual(len(_Collector.bodies), 1)
        self.assertEqual(_Collector.bodies[0]["agent_id"], 42)
        self.assertEqual(_Collector.bodies[0]["seven_day_used_percentage"], 41.2)
