import shlex

from app.ai.provider import Provider, ProviderCommand


class ClaudeProvider(Provider):
    slug = "claude"
    display_name = "Claude"
    default_models = ("claude-opus-5", "claude-sonnet-5", "claude-fable-5")

    def build_command(self, command: ProviderCommand) -> str:
        parts = ["claude"]
        if command.worktree:
            parts.extend(("--worktree", shlex.quote(command.worktree)))
        if command.continue_session:
            parts.append("--continue")
        if command.system_prompt_file:
            path = shlex.quote(command.system_prompt_file)
            parts.extend(("--system-prompt", f'"$(cat {path})"'))
        if command.model:
            parts.extend(("--model", shlex.quote(command.model)))
        if command.allowed_tools:
            parts.extend(("--allowedTools", shlex.quote(",".join(command.allowed_tools))))
        if command.disallowed_tools:
            parts.extend(("--disallowedTools", shlex.quote(",".join(command.disallowed_tools))))
        if command.permission_mode:
            parts.extend(("--permission-mode", shlex.quote(command.permission_mode)))
        if command.skip_permissions:
            parts.append("--dangerously-skip-permissions")
        if command.verbose:
            parts.append("--verbose")
        if command.max_turns is not None:
            parts.extend(("--max-turns", str(command.max_turns)))
        return " ".join(parts)
