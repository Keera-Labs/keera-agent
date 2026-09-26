import json
import os
from pathlib import Path

from app.utils.json_utils import atomic_write_json

REMOTE_CONTROL_KEY = "remoteControlAtStartup"


class InvalidClaudeConfig(Exception):
    pass


def claude_config_path() -> Path:
    """Claude CLI's global config: $CLAUDE_CONFIG_DIR/.claude.json, else ~/.claude.json."""
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home()) / ".claude.json"


class ClaudeConfig:
    """Reads and writes single keys of the Claude CLI global config.

    Running claude processes write this file too, so every write re-reads it,
    changes one key and atomically replaces it; a file that is not a JSON
    object is refused rather than clobbered.
    """

    def __init__(self, path: Path | None = None):
        self.path = path or claude_config_path()

    def _load(self) -> dict:
        try:
            with open(self.path) as handle:
                data = json.load(handle)
        except FileNotFoundError:
            return {}
        except ValueError as error:
            raise InvalidClaudeConfig(f"{self.path} is not valid JSON") from error
        if not isinstance(data, dict):
            raise InvalidClaudeConfig(f"{self.path} is not valid JSON config (expected an object)")
        return data

    def get(self, key: str, default=None):
        return self._load().get(key, default)

    def set(self, key: str, value) -> None:
        data = self._load()
        data[key] = value
        # Resolved so a symlinked config (e.g. from a dotfiles repo) is updated, not replaced.
        atomic_write_json(str(self.path.resolve()), data)
