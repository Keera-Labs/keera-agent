import shlex
from pathlib import Path

from app.ai.provider import Provider, ProviderCommand


class GeminiProvider(Provider):
    slug = "gemini"
    display_name = "Gemini CLI"
    default_models = ("gemini-2.5-flash", "gemini-2.5-pro")

    def build_command(self, command: ProviderCommand) -> str:
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
