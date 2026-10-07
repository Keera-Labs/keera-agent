"""Per-workspace Claude Code config dir (CLAUDE_CONFIG_DIR), so one Keera can drive
several Claude accounts. A workspace without one leaves Claude on its default."""

import os

from app.models.Workspace import Workspace

CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR"


def expand_config_dir(value: str | None) -> str | None:
    """The stored setting (e.g. ``~/.claude-work``) as an absolute path, or None when unset."""
    value = (value or "").strip()
    return os.path.expanduser(value) if value else None


def default_config_dir() -> str:
    """The dir Claude uses when Keera sets no override: Keera's own env, else ~/.claude."""
    return os.path.expanduser(os.environ.get(CONFIG_DIR_ENV) or os.path.join("~", ".claude"))


def claude_env(config_dir: str | None) -> dict:
    return {CONFIG_DIR_ENV: config_dir} if config_dir else {}


async def project_config_dir(project) -> str | None:
    """The workspace override for a project's Claude processes, or None to keep the default."""
    workspace_id = getattr(project, "workspace_id", None) if project else None
    if not workspace_id:
        return None
    workspace = await Workspace.find(workspace_id)
    return expand_config_dir(workspace.claude_config_dir) if workspace else None


async def agent_config_dir(agent, project) -> str | None:
    # Codex has its own config home; CLAUDE_CONFIG_DIR only matters to claude agents.
    if getattr(agent, "provider", None) != "claude":
        return None
    return await project_config_dir(project)


async def all_config_dirs() -> list[str]:
    """The default dir plus every workspace override, each once."""
    dirs = [default_config_dir()]
    for workspace in await Workspace.where_not_null("claude_config_dir").get():
        expanded = expand_config_dir(workspace.claude_config_dir)
        if expanded and expanded not in dirs:
            dirs.append(expanded)
    return dirs
