"""Token usage read from Claude Code's session transcripts (never written to).

Claude Code appends every assistant message, with its `usage`, to
`~/.claude/projects/<encoded cwd>/<session>.jsonl` (subagents under
`<session>/subagents/`). Keera agents run in `<project>/.claude/worktrees/agent-<id>`,
so each transcript directory maps to one agent, or to the project itself.
"""

import datetime
import json
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

AGENT_DIR_MARKER = "--claude-worktrees-agent-"
SYNTHETIC_MODEL = "<synthetic>"


def claude_projects_dir() -> Path:
    return Path(os.environ.get("KEERA_CLAUDE_PROJECTS_DIR", "~/.claude/projects")).expanduser()


def encode_cwd(path: str) -> str:
    """Claude Code's directory name for a working directory."""
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(os.path.expanduser(path)))


@dataclass
class Tokens:
    input: int = 0
    output: int = 0
    cache_creation: int = 0
    cache_read: int = 0

    @property
    def total(self) -> int:
        return self.input + self.output + self.cache_creation + self.cache_read

    def add(self, other: "Tokens") -> None:
        self.input += other.input
        self.output += other.output
        self.cache_creation += other.cache_creation
        self.cache_read += other.cache_read

    def to_dict(self) -> dict:
        return {
            "input": self.input,
            "output": self.output,
            "cache_creation": self.cache_creation,
            "cache_read": self.cache_read,
            "total": self.total,
        }


@dataclass
class AgentUsage:
    tokens: Tokens = field(default_factory=Tokens)
    last_model: str | None = None
    last_used_at: str | None = None

    def to_dict(self) -> dict:
        return {
            **self.tokens.to_dict(),
            "last_model": self.last_model,
            "last_used_at": self.last_used_at,
        }


@dataclass
class ProjectUsage:
    id: int
    today: Tokens = field(default_factory=Tokens)
    agents: dict[int, AgentUsage] = field(default_factory=dict)


@dataclass(frozen=True)
class _Message:
    timestamp: str
    day: datetime.date
    model: str | None
    tokens: Tokens


@dataclass
class _FileState:
    inode: int
    offset: int = 0
    messages: dict[str, _Message] = field(default_factory=dict)


class ClaudeUsageReader:
    """Aggregates transcript usage, re-reading only the bytes appended since the last call."""

    def __init__(self):
        self._files: dict[Path, _FileState] = {}
        self._lock = threading.Lock()

    def project_usage(
        self, project_id: int, project_path: str, today: datetime.date | None = None
    ) -> ProjectUsage:
        today = today or datetime.date.today()
        usage = ProjectUsage(id=project_id)
        with self._lock:
            for agent_id, directory in self._transcript_dirs(project_path):
                messages = self._messages(directory)
                agent = AgentUsage() if agent_id is not None else None
                for message in messages:
                    if message.day == today:
                        usage.today.add(message.tokens)
                    if agent:
                        agent.tokens.add(message.tokens)
                        if message.model and (agent.last_used_at or "") <= message.timestamp:
                            agent.last_model = message.model
                            agent.last_used_at = message.timestamp
                if agent and agent.tokens.total:
                    usage.agents[agent_id] = agent
        return usage

    def _transcript_dirs(self, project_path: str) -> list[tuple[int | None, Path]]:
        base = claude_projects_dir()
        if not base.is_dir():
            return []
        encoded = encode_cwd(project_path)
        dirs: list[tuple[int | None, Path]] = []
        for entry in base.iterdir():
            if not entry.is_dir():
                continue
            if entry.name == encoded:
                dirs.append((None, entry))
            elif entry.name.startswith(encoded + AGENT_DIR_MARKER):
                suffix = entry.name[len(encoded + AGENT_DIR_MARKER) :]
                if suffix.isdigit():
                    dirs.append((int(suffix), entry))
        return dirs

    def _messages(self, directory: Path) -> list[_Message]:
        # A resumed session copies earlier messages into its new file, so the
        # same message can appear in several transcripts of one directory.
        unique: dict[str, _Message] = {}
        for path in sorted(directory.rglob("*.jsonl")):
            for key, message in self._read(path).items():
                unique.setdefault(key, message)
        return list(unique.values())

    def _read(self, path: Path) -> dict[str, _Message]:
        try:
            stat = path.stat()
        except OSError:
            self._files.pop(path, None)
            return {}
        state = self._files.get(path)
        if state is None or state.inode != stat.st_ino or stat.st_size < state.offset:
            state = self._files[path] = _FileState(inode=stat.st_ino)
        if stat.st_size == state.offset:
            return state.messages

        try:
            with path.open("rb") as handle:
                handle.seek(state.offset)
                chunk = handle.read()
        except OSError:
            return state.messages
        # Only consume complete lines; a half-written last line is read next time.
        complete = chunk[: chunk.rfind(b"\n") + 1]
        state.offset += len(complete)
        for line in complete.splitlines():
            parsed = _parse_line(line)
            if parsed:
                state.messages.setdefault(*parsed)
        return state.messages


def _parse_line(line: bytes) -> tuple[str, _Message] | None:
    if b'"usage"' not in line:
        return None
    try:
        record = json.loads(line)
    except ValueError:
        return None
    message = record.get("message") if isinstance(record, dict) else None
    if record.get("type") != "assistant" or not isinstance(message, dict):
        return None
    usage = message.get("usage")
    timestamp = record.get("timestamp")
    if not isinstance(usage, dict) or not isinstance(timestamp, str) or not message.get("id"):
        return None
    try:
        moment = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return None

    # Streaming writes one line per content block, all repeating the same usage.
    key = f"{message.get('id')}:{record.get('requestId')}"
    model = message.get("model")
    tokens = Tokens(
        input=_count(usage, "input_tokens"),
        output=_count(usage, "output_tokens"),
        cache_creation=_count(usage, "cache_creation_input_tokens"),
        cache_read=_count(usage, "cache_read_input_tokens"),
    )
    return key, _Message(
        timestamp=moment.astimezone(datetime.UTC).isoformat(),
        day=moment.astimezone().date(),
        model=model if isinstance(model, str) and model != SYNTHETIC_MODEL else None,
        tokens=tokens,
    )


def _count(usage: dict, name: str) -> int:
    value = usage.get(name)
    return value if isinstance(value, int) else 0


claude_usage = ClaudeUsageReader()
