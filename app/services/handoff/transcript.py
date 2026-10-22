import base64
import json
import os
import re
from pathlib import Path

from app.services.handoff.errors import HandoffInvalid

SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,127}$")
_PATH_CHARS = "A-Za-z0-9._-"


def encoded_dir_name(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9-]", "-", path)


def transcript_dir(config_dir: str, cwd: str) -> Path:
    return Path(config_dir) / "projects" / encoded_dir_name(cwd)


class PathRewriter:
    def __init__(self, mapping: dict[str, str]):
        self.mapping = {
            source: target for source, target in mapping.items() if source and source != target
        }
        sources = sorted(self.mapping, key=len, reverse=True)
        alternation = "|".join(re.escape(source) for source in sources)
        self.pattern = (
            re.compile(rf"(?<![{_PATH_CHARS}])(?:{alternation})(?![{_PATH_CHARS}])")
            if sources
            else None
        )

    def text(self, value: str) -> str:
        if self.pattern is None:
            return value
        return self.pattern.sub(lambda match: self.mapping[match.group(0)], value)

    def value(self, value):
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, list):
            return [self.value(item) for item in value]
        if isinstance(value, dict):
            return {self.text(key): self.value(item) for key, item in value.items()}
        return value

    def jsonl(self, content: str) -> str:
        return "".join(self._line(line) for line in content.splitlines(keepends=True))

    def _line(self, line: str) -> str:
        body = line.rstrip("\r\n")
        ending = line[len(body) :]
        if not body.strip():
            return line
        try:
            entry = json.loads(body)
        except json.JSONDecodeError:
            return self.text(body) + ending
        return json.dumps(self.value(entry), ensure_ascii=False, separators=(",", ":")) + ending


def latest_session_id(directory: Path) -> str | None:
    sessions = sorted(directory.glob("*.jsonl"), key=lambda path: path.stat().st_mtime)
    return sessions[-1].stem if sessions else None


def export_session(directory: Path, session_id: str) -> list[dict]:
    main = directory / f"{session_id}.jsonl"
    if not main.is_file():
        raise HandoffInvalid("The agent has no Claude conversation to hand off.")
    extras = sorted(path for path in (directory / session_id).rglob("*") if path.is_file())
    return [_export_file(directory, path) for path in (main, *extras)]


def _export_file(directory: Path, path: Path) -> dict:
    raw = path.read_bytes()
    relative = path.relative_to(directory).as_posix()
    try:
        return {"path": relative, "encoding": "text", "content": raw.decode("utf-8")}
    except UnicodeDecodeError:
        return {"path": relative, "encoding": "base64", "content": base64.b64encode(raw).decode()}


def install_session(
    directory: Path, session_id: str, files: list[dict], rewriter: PathRewriter
) -> list[Path]:
    if not SESSION_ID.match(session_id):
        raise HandoffInvalid("The handoff carries an invalid session id.")
    if not any(file["path"] == f"{session_id}.jsonl" for file in files):
        raise HandoffInvalid("The handoff is missing the session transcript.")
    targets = [(_safe_target(directory, session_id, file["path"]), file) for file in files]
    written = []
    for target, file in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(_installed_bytes(file, rewriter))
        written.append(target)
    return written


def _safe_target(directory: Path, session_id: str, relative: str) -> Path:
    parts = Path(relative).parts
    allowed = relative == f"{session_id}.jsonl" or (len(parts) > 1 and parts[0] == session_id)
    if not allowed or os.path.isabs(relative) or ".." in parts:
        raise HandoffInvalid("The handoff carries a transcript file outside its session.")
    return directory / relative


def _installed_bytes(file: dict, rewriter: PathRewriter) -> bytes:
    if file.get("encoding") == "base64":
        return base64.b64decode(file["content"])
    content = file["content"]
    rewritten = (
        rewriter.jsonl(content) if file["path"].endswith(".jsonl") else rewriter.text(content)
    )
    return rewritten.encode("utf-8")
