import os
import sys
from collections.abc import Mapping
from functools import cache
from pathlib import Path

from dotenv import dotenv_values

KEERA_ROOT = Path(__file__).resolve().parents[2]
VENV_KEYS = frozenset({"VIRTUAL_ENV", "VIRTUAL_ENV_PROMPT"})


@cache
def keera_dotenv_keys(root: Path = KEERA_ROOT, app_env: str | None = None) -> frozenset[str]:
    app_env = app_env or os.environ.get("APP_ENV")
    files = [root / ".env", *([root / f".env.{app_env}"] if app_env else [])]
    return frozenset(key for path in files if path.is_file() for key in dotenv_values(path))


def user_env(
    source: Mapping[str, str] | None = None, hidden_keys: frozenset[str] | None = None
) -> dict:
    source = os.environ if source is None else source
    hidden = (keera_dotenv_keys() if hidden_keys is None else hidden_keys) | VENV_KEYS
    env = {key: value for key, value in source.items() if key not in hidden}
    if "PATH" in source:
        env["PATH"] = _without_keera_venv(source["PATH"], source.get("VIRTUAL_ENV"))
    return env


def _without_keera_venv(path: str, virtual_env: str | None) -> str:
    venvs = {
        Path(p).resolve()
        for p in (virtual_env, sys.prefix if sys.prefix != sys.base_prefix else None)
        if p
    }
    bins = {venv / "bin" for venv in venvs}
    return os.pathsep.join(
        entry for entry in path.split(os.pathsep) if not entry or Path(entry).resolve() not in bins
    )
