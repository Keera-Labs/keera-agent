"""Token usage read from Codex's session rollouts (never written to).

Codex writes one `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` per session. Its
`session_meta` line holds the working directory, `turn_context` lines the model, and
`token_count` events the session's cumulative usage. Rollouts are not grouped by
directory, so each file's cwd is matched against the project and its agent worktrees.
"""

import datetime
import json
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.services.claude_usage import AgentUsage, ProjectUsage, Tokens

AGENT_WORKTREE = os.path.join(".claude", "worktrees", "agent-")
RELEVANT = (b'"session_meta"', b'"turn_context"', b'"token_count"')


def codex_sessions_dir() -> Path:
    return Path(os.environ.get("KEERA_CODEX_SESSIONS_DIR", "~/.codex/sessions")).expanduser()


@dataclass(frozen=True)
class _Usage:
    timestamp: str
    day: datetime.date
    model: str | None
    tokens: Tokens


@dataclass
class _Rollout:
    inode: int
    offset: int = 0
    cwd: str | None = None
    model: str | None = None
    cumulative: Tokens = field(default_factory=Tokens)
    usages: list[_Usage] = field(default_factory=list)


class CodexUsageReader:
    """Aggregates rollout usage, re-reading only the bytes appended since the last call."""

    def __init__(self):
        self._files: dict[Path, _Rollout] = {}
        self._lock = threading.Lock()

    def project_usage(
        self, project_id: int, project_path: str, today: datetime.date | None = None
    ) -> ProjectUsage:
        today = today or datetime.date.today()
        usage = ProjectUsage(id=project_id)
        project = os.path.realpath(os.path.expanduser(project_path))
        with self._lock:
            for rollout in self._rollouts():
                owner = _owner(rollout.cwd, project)
                if owner is False:
                    continue
                agent = usage.agents.setdefault(owner, AgentUsage()) if owner else None
                for item in rollout.usages:
                    if item.day == today:
                        usage.today.add(item.tokens)
                    if agent:
                        agent.tokens.add(item.tokens)
                        if item.model and (agent.last_used_at or "") <= item.timestamp:
                            agent.last_model = item.model
                            agent.last_used_at = item.timestamp
        usage.agents = {key: agent for key, agent in usage.agents.items() if agent.tokens.total}
        return usage

    def _rollouts(self) -> list[_Rollout]:
        base = codex_sessions_dir()
        if not base.is_dir():
            return []
        paths = set(base.rglob("rollout-*.jsonl"))
        for gone in self._files.keys() - paths:
            del self._files[gone]
        return [rollout for path in sorted(paths) if (rollout := self._read(path))]

    def _read(self, path: Path) -> _Rollout | None:
        try:
            stat = path.stat()
        except OSError:
            self._files.pop(path, None)
            return None
        rollout = self._files.get(path)
        if rollout is None or rollout.inode != stat.st_ino or stat.st_size < rollout.offset:
            rollout = self._files[path] = _Rollout(inode=stat.st_ino)
        if stat.st_size == rollout.offset:
            return rollout

        try:
            with path.open("rb") as handle:
                handle.seek(rollout.offset)
                chunk = handle.read()
        except OSError:
            return rollout
        # Only consume complete lines; a half-written last line is read next time.
        complete = chunk[: chunk.rfind(b"\n") + 1]
        rollout.offset += len(complete)
        for line in complete.splitlines():
            if any(marker in line for marker in RELEVANT):
                _apply(rollout, line)
        return rollout


def _owner(cwd: str | None, project: str) -> int | None | bool:
    """The agent id a rollout belongs to, None for the project itself, False otherwise."""
    if not cwd:
        return False
    cwd = os.path.realpath(cwd)
    if cwd == project:
        return None
    suffix = cwd.removeprefix(os.path.join(project, AGENT_WORKTREE))
    return int(suffix) if suffix != cwd and suffix.isdigit() else False


def _apply(rollout: _Rollout, line: bytes) -> None:
    try:
        record = json.loads(line)
    except ValueError:
        return
    payload = record.get("payload") if isinstance(record, dict) else None
    if not isinstance(payload, dict):
        return
    kind = record.get("type")
    if kind == "session_meta" and isinstance(payload.get("cwd"), str):
        rollout.cwd = payload["cwd"]
    elif kind == "turn_context" and isinstance(payload.get("model"), str):
        rollout.model = payload["model"]
    elif kind == "event_msg" and payload.get("type") == "token_count":
        _count_tokens(rollout, record.get("timestamp"), payload.get("info"))


def _count_tokens(rollout: _Rollout, timestamp, info) -> None:
    total = info.get("total_token_usage") if isinstance(info, dict) else None
    if not isinstance(total, dict) or not isinstance(timestamp, str):
        return
    try:
        moment = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return

    cached = _count(total, "cached_input_tokens")
    # OpenAI counts cached tokens inside input_tokens and reasoning inside
    # output_tokens; split them so the kinds match Claude's.
    cumulative = Tokens(
        input=max(0, _count(total, "input_tokens") - cached),
        output=_count(total, "output_tokens"),
        cache_creation=_count(total, "cache_write_input_tokens"),
        cache_read=cached,
    )
    # Codex repeats the same cumulative count (e.g. on rate-limit updates), so only
    # the growth since the previous event is new usage.
    previous = rollout.cumulative
    delta = Tokens(
        input=cumulative.input - previous.input,
        output=cumulative.output - previous.output,
        cache_creation=cumulative.cache_creation - previous.cache_creation,
        cache_read=cumulative.cache_read - previous.cache_read,
    )
    if min(delta.input, delta.output, delta.cache_creation, delta.cache_read) < 0:
        delta = cumulative  # The counter restarted.
    rollout.cumulative = cumulative
    if delta.total:
        rollout.usages.append(
            _Usage(
                timestamp=moment.astimezone(datetime.UTC).isoformat(),
                day=moment.astimezone().date(),
                model=rollout.model,
                tokens=delta,
            )
        )


def _count(usage: dict, name: str) -> int:
    value = usage.get(name)
    return value if isinstance(value, int) else 0


codex_usage = CodexUsageReader()
