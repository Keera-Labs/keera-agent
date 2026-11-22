import hashlib
import os
import tempfile
from pathlib import Path

from app.utils.process_env import KEERA_ROOT

INSTALL_TAG = hashlib.sha256(str(KEERA_ROOT).encode()).hexdigest()[:8]


def antigravity_agents_dir() -> Path:
    return Path.home() / ".gemini" / "config" / "agents"


def antigravity_agent_name(agent_id: int) -> str:
    return f"keera-{INSTALL_TAG}-agent-{agent_id}"


def write_antigravity_agent(
    agent_id: int, system_prompt_file: str | None, directory: Path | None = None
) -> str | None:
    directory = directory or antigravity_agents_dir()
    prompt = Path(system_prompt_file).read_text() if system_prompt_file else ""
    if not prompt.strip():
        remove_antigravity_agent(agent_id, directory)
        return None
    name = antigravity_agent_name(agent_id)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    _atomic_write_private(
        directory / f"{name}.md",
        f"---\nname: {name}\ndescription: Keera agent {agent_id}\n---\n{prompt}",
    )
    return name


def remove_antigravity_agent(agent_id: int, directory: Path | None = None) -> None:
    directory = directory or antigravity_agents_dir()
    (directory / f"{antigravity_agent_name(agent_id)}.md").unlink(missing_ok=True)


def _atomic_write_private(path: Path, content: str) -> None:
    descriptor, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as file:
            file.write(content)
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise
