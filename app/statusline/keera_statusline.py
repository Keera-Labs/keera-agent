"""Keera's Claude Code statusline, given to agents with `claude --settings`.

A statusLine set with --settings replaces the user's own for that session, so this
script chains to it: the user's statusline gets the same stdin and its output is
printed unchanged. In parallel it forwards the plan-limit and context usage to Keera.
Claude Code runs this on every refresh, so it must stay fast and never fail.
Stdlib only: it runs under Keera's interpreter but outside the app.

Usage: python keera_statusline.py <report url>
"""

import json
import os
import subprocess
import sys
import threading
import urllib.request

AGENT_ID_ENV = "KEERA_AGENT_ID"
MARKER = "keera_statusline"
CHAIN_TIMEOUT = 2.0
REPORT_TIMEOUT = 1.0
LIMIT_WINDOWS = ("five_hour", "seven_day")


def _get(data, *keys):
    for key in keys:
        data = data.get(key) if isinstance(data, dict) else None
    return data


def report_body(agent_id: int, payload: dict) -> dict:
    body = {
        "agent_id": agent_id,
        "session_id": _get(payload, "session_id"),
        "model": _get(payload, "model", "id"),
        "context_used_percentage": _get(payload, "context_window", "used_percentage"),
        "context_window_size": _get(payload, "context_window", "context_window_size"),
    }
    for window in LIMIT_WINDOWS:
        body[f"{window}_used_percentage"] = _get(payload, "rate_limits", window, "used_percentage")
        body[f"{window}_resets_at"] = _get(payload, "rate_limits", window, "resets_at")
    return body


def user_statusline_command(cwd: str | None) -> str | None:
    """The statusLine command Claude Code would run without Keera's --settings."""
    candidates = (
        [os.path.join(cwd, ".claude", name) for name in ("settings.local.json", "settings.json")]
        if cwd
        else []
    )
    candidates.append(os.path.expanduser(os.path.join("~", ".claude", "settings.json")))
    for path in candidates:
        try:
            with open(path) as handle:
                line = _get(json.load(handle), "statusLine")
        except (OSError, ValueError):
            continue
        if not isinstance(line, dict) or line.get("type", "command") != "command":
            continue
        command = line.get("command")
        if isinstance(command, str) and command.strip() and MARKER not in command:
            return command
    return None


def summary(payload: dict) -> str:
    """A compact line for when the user has no statusline of their own."""
    parts = []
    for window, label in zip(LIMIT_WINDOWS, ("5h", "wk")):
        used = _get(payload, "rate_limits", window, "used_percentage")
        if isinstance(used, (int, float)):
            parts.append(f"{label} {used:.0f}%")
    context = _get(payload, "context_window", "used_percentage")
    if isinstance(context, (int, float)):
        parts.append(f"ctx {context:.0f}%")
    return " · ".join(parts)


def _report(url: str | None, payload: dict) -> None:
    agent_id = os.environ.get(AGENT_ID_ENV, "")
    if not url or not agent_id.isdigit():
        return
    request = urllib.request.Request(
        url,
        data=json.dumps(report_body(int(agent_id), payload)).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=REPORT_TIMEOUT).close()
    except Exception:
        pass


def _chain(raw: bytes, payload: dict) -> str:
    cwd = _get(payload, "workspace", "current_dir") or _get(payload, "cwd") or os.getcwd()
    command = user_statusline_command(cwd)
    if not command:
        return ""
    try:
        result = subprocess.run(
            command, shell=True, input=raw, capture_output=True, timeout=CHAIN_TIMEOUT
        )
    except Exception:
        return ""
    return result.stdout.decode(errors="replace")


def main(argv: list[str]) -> None:
    raw = sys.stdin.buffer.read()
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    reporter = threading.Thread(
        target=_report, args=(argv[1] if len(argv) > 1 else None, payload), daemon=True
    )
    reporter.start()
    output = _chain(raw, payload)
    sys.stdout.write(output if output.strip() else summary(payload))
    sys.stdout.flush()
    reporter.join(REPORT_TIMEOUT)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except BaseException:
        pass
    sys.exit(0)
