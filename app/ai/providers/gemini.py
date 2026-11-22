import shlex
from pathlib import Path

from app.ai.provider import Provider, ProviderCommand


class GeminiProvider(Provider):
    slug = "gemini"
    display_name = "Gemini CLI"
    default_models = ("gemini-3.8-flash",)
    thinking_levels = ("low", "medium", "high", "xhigh", "max")

    def build_command(self, command: ProviderCommand) -> str:
        if command.binary == "agy":
            return self._build_antigravity_command(command)
        parts = []
        if command.settings_file:
            parts.append(
                f"GEMINI_CLI_HOME={shlex.quote(str(Path(command.settings_file).parent.parent))}"
            )
        parts.append("gemini")
        if command.model:
            parts.extend(("--model", shlex.quote(command.model)))
        if command.continue_session:
            parts.extend(("--resume", "latest"))
        mode = (
            "plan"
            if command.permission_mode == "plan"
            else ("yolo" if command.skip_permissions else "default")
        )
        parts.extend(("--approval-mode", mode))
        if command.allowed_tools:
            parts.extend(("--allowed-tools", shlex.quote(",".join(command.allowed_tools))))
        if command.verbose:
            parts.append("--debug")
        return " ".join(parts)

    def _build_antigravity_command(self, command: ProviderCommand) -> str:
        parts = ["agy"]
        if command.rules_dir:
            parts.extend(("--add-dir", shlex.quote(command.rules_dir)))
        if command.model:
            parts.extend(("--model", shlex.quote(command.model)))
        if command.thinking_level:
            parts.extend(("--effort", shlex.quote(command.thinking_level)))
        if command.continue_session:
            parts.append("--continue")
        if command.permission_mode == "plan":
            parts.extend(("--mode", "plan"))
        elif command.skip_permissions:
            parts.append("--dangerously-skip-permissions")
        return " ".join(parts)
