import shlex

from app.ai.provider import Provider, ProviderCommand


class CodexProvider(Provider):
    slug = "codex"
    display_name = "Codex"
    default_models = ("gpt-5.3-codex",)

    def build_command(self, command: ProviderCommand) -> str:
        parts = ["codex"]
        if command.continue_session:
            parts.extend(("resume", "--last"))
        if command.model:
            parts.extend(("--model", shlex.quote(command.model)))
        if command.system_prompt_file:
            path = shlex.quote(command.system_prompt_file)
            parts.extend(("--config", f'developer_instructions="$(cat {path})"'))
        if command.permission_mode == "plan":
            parts.extend(("--sandbox", "read-only"))
        elif command.skip_permissions:
            parts.append("--dangerously-bypass-approvals-and-sandbox")
        else:
            parts.extend(("--ask-for-approval", "on-request"))
        return " ".join(parts)
