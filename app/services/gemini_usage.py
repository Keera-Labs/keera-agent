import datetime
import hashlib
import json
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.services.claude_usage import AgentUsage, ProjectUsage, Tokens


def gemini_storage_dir() -> Path:
    return Path(
        os.environ.get(
            "KEERA_GEMINI_STORAGE_DIR", Path(__file__).resolve().parents[2] / "storage" / "gemini"
        )
    ).expanduser()


@dataclass(frozen=True)
class _Message:
    timestamp: str
    day: datetime.date
    model: str | None
    tokens: Tokens
    cost: float | None


@dataclass
class _Session:
    signature: tuple[int, int, int]
    offset: int = 0
    project_hash: str | None = None
    tail: bytes = b""
    messages: dict[str, _Message] = field(default_factory=dict)


class GeminiUsageReader:
    def __init__(self):
        self._files: dict[Path, _Session] = {}
        self._lock = threading.Lock()

    def project_usage(
        self,
        project_id: int,
        project_path: str,
        agent_ids: list[int],
        today: datetime.date | None = None,
    ) -> ProjectUsage:
        today = today or datetime.date.today()
        usage = ProjectUsage(id=project_id)
        today_costs = []
        root = gemini_storage_dir()
        with self._lock:
            for agent_id in agent_ids:
                paths = {
                    os.path.expanduser(project_path),
                    os.path.realpath(os.path.expanduser(project_path)),
                }
                paths.update(
                    os.path.join(path, ".claude", "worktrees", f"agent-{agent_id}")
                    for path in list(paths)
                )
                hashes = {hashlib.sha256(path.encode()).hexdigest() for path in paths}
                directory = root / f"agent-{agent_id}" / ".gemini" / "tmp"
                unique = {}
                if not directory.is_dir():
                    continue
                files = {
                    path
                    for chats in directory.glob("*/chats")
                    for path in chats.rglob("*")
                    if path.suffix in (".json", ".jsonl") and path.is_file()
                }
                for path in sorted(files):
                    session = self._read(path)
                    if session and session.project_hash in hashes:
                        for key, message in session.messages.items():
                            unique[key] = message
                agent = AgentUsage()
                costs = []
                for message in unique.values():
                    if message.day == today:
                        usage.today.add(message.tokens)
                        today_costs.append(message.cost)
                    agent.tokens.add(message.tokens)
                    costs.append(message.cost)
                    if message.model and (agent.last_used_at or "") <= message.timestamp:
                        agent.last_model, agent.last_used_at = message.model, message.timestamp
                if agent.tokens.total:
                    agent.gemini_estimated_cost_usd = _sum_costs(costs)
                    usage.agents[agent_id] = agent
            usage.gemini_estimated_cost_usd = _sum_costs(today_costs)
            self._files = {path: state for path, state in self._files.items() if path.exists()}
        return usage

    def _read(self, path: Path) -> _Session | None:
        previous = self._files.get(path)
        try:
            stat = path.stat()
            signature = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
            if previous and previous.signature == signature:
                return previous
            if path.suffix == ".json":
                record = json.loads(path.read_text())
                if not isinstance(record, dict):
                    return None
                state = _Session(signature=signature)
                _apply(state, record)
                messages = record.get("messages")
                for message in messages if isinstance(messages, list) else []:
                    _apply(state, message)
            else:
                if (
                    previous
                    and previous.signature[0] == stat.st_ino
                    and stat.st_size > previous.signature[1]
                ):
                    state = previous
                else:
                    state = _Session(signature=signature)
                with path.open("rb") as handle:
                    if state.offset:
                        handle.seek(state.offset - len(state.tail))
                        if handle.read(len(state.tail)) != state.tail:
                            state = _Session(signature=signature)
                    handle.seek(state.offset)
                    chunk = handle.read()
                complete = chunk[: chunk.rfind(b"\n") + 1]
                for line in complete.splitlines():
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue
                    _apply(state, record)
                state.tail = (state.tail + complete)[-256:]
                state.offset += len(complete)
                state.signature = signature
            self._files[path] = state
            return state
        except (OSError, ValueError):
            return previous if path.suffix == ".json" else None


def _apply(state: _Session, record) -> None:
    if not isinstance(record, dict):
        return
    if isinstance(record.get("projectHash"), str):
        state.project_hash = record["projectHash"]
    if record.get("type") != "gemini" or not isinstance(record.get("tokens"), dict):
        return
    key, timestamp = record.get("id"), record.get("timestamp")
    if not isinstance(key, str) or not isinstance(timestamp, str):
        return
    try:
        moment = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return
    counts = record["tokens"]
    cached = min(_count(counts, "cached"), _count(counts, "input"))
    input_count = _count(counts, "input")
    output_count = _count(counts, "output") + _count(counts, "thoughts")
    tool_count = _count(counts, "tool")
    total = _count(counts, "total")
    if total >= input_count + output_count:
        tool_count = min(tool_count, total - input_count - output_count)
    tokens = Tokens(
        input=input_count - cached + tool_count,
        output=output_count,
        cache_read=cached,
    )
    model = record.get("model") if isinstance(record.get("model"), str) else None
    state.messages[key] = _Message(
        timestamp=moment.astimezone(datetime.UTC).isoformat(),
        day=moment.astimezone().date(),
        model=model,
        tokens=tokens,
        cost=_estimate_cost(model, tokens, moment.date()),
    )


def _count(counts: dict, name: str) -> int:
    value = counts.get(name)
    return max(0, value) if type(value) is int else 0


def _estimate_cost(model: str | None, tokens: Tokens, day: datetime.date) -> float | None:
    if model != "gemini-3.8-flash":
        return None
    multiplier = 1 if day < datetime.date(2027, 1, 1) else 2
    return (
        multiplier
        * (tokens.input * 0.75 + tokens.output * 3.75 + tokens.cache_read * 0.075)
        / 1_000_000
    )


def _sum_costs(costs: list[float | None]) -> float | None:
    return sum(costs) if costs and all(cost is not None for cost in costs) else None


gemini_usage = GeminiUsageReader()
