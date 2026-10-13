import json
import os
import shlex
from pathlib import Path

from app.ai import ProviderCommand
from app.utils.json_utils import atomic_write_json


def write_gemini_settings(
    agent_id: int,
    base_url: str,
    command: ProviderCommand,
    storage: Path | None = None,
    source_home: Path | None = None,
) -> str:
    storage = storage or Path(__file__).resolve().parents[2] / "storage" / "gemini"
    home = storage / f"agent-{agent_id}"
    directory = home / ".gemini"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    source = (source_home or Path(os.environ.get("GEMINI_CLI_HOME", Path.home()))) / ".gemini"
    source_settings = source / "settings.json"
    settings = json.loads(source_settings.read_text()) if source_settings.exists() else {}
    settings_path = directory / "settings.json"
    previous = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    settings.setdefault("security", {})["auth"] = {
        **previous.get("security", {}).get("auth", {}),
        **settings.get("security", {}).get("auth", {}),
    }
    for name in (
        "oauth_creds.json",
        "google_accounts.json",
        "mcp-oauth-tokens.json",
        "trustedFolders.json",
        "commands",
        "skills",
        "extensions",
        "policies",
        "agents",
        "GEMINI.md",
        "keybindings.json",
    ):
        target = directory / name
        original = source / name
        if original.exists() and not target.exists() and not target.is_symlink():
            target.symlink_to(original.resolve(), target_is_directory=original.is_dir())
    context_path = directory / "context.json"
    context = Path(command.system_prompt_file).read_text() if command.system_prompt_file else ""
    atomic_write_json(
        str(context_path),
        {"hookSpecificOutput": {"hookEventName": "BeforeAgent", "additionalContext": context}},
    )
    hooks = {}
    for event, endpoint in (
        ("BeforeAgent", "/api/agent-hook-events"),
        ("AfterTool", "/api/agent-hook-events"),
        ("Notification", "/api/agent-hook-events"),
        ("AfterAgent", "/api/claude-stopped"),
    ):
        hook_command = (
            "curl --silent --show-error --max-time 5 --output /dev/null "
            "-H 'Content-Type: application/json' "
            f"-H 'X-Keera-Agent-Id: {agent_id}' --data-binary @- "
            f"{shlex.quote(base_url.rstrip('/') + endpoint)}; "
        )
        hook_command += (
            f"cat {shlex.quote(str(context_path))}" if event == "BeforeAgent" else "printf '{}'"
        )
        hooks[event] = [{"hooks": [{"name": "keera", "type": "command", "command": hook_command}]}]
    settings.setdefault("mcpServers", {})["keera"] = {"httpUrl": base_url.rstrip("/") + "/mcp"}
    existing_hooks = settings.setdefault("hooks", {})
    for event, definitions in hooks.items():
        existing_hooks[event] = [*existing_hooks.get(event, []), *definitions]
    settings.setdefault("tools", {})["exclude"] = list(
        dict.fromkeys(
            [
                *settings.get("tools", {}).get("exclude", []),
                *command.disallowed_tools,
            ]
        )
    )
    settings.setdefault("general", {})["enableAutoUpdate"] = False
    if command.max_turns:
        settings.setdefault("model", {})["maxSessionTurns"] = command.max_turns
    settings.setdefault("hooksConfig", {})["enabled"] = True
    if command.permission_mode == "plan":
        settings.setdefault("general", {}).setdefault("plan", {})["enabled"] = True
    atomic_write_json(str(settings_path), settings)
    return str(settings_path)
