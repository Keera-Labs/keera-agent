import json

from fastapi_startkit.masoniteorm import Model

from app.ai import ProviderCommand, providers


class Agent(Model):
    __table__ = "agents"
    id: int
    flags: dict
    permissions_allow: list
    permissions_deny: list
    dangerously_skip_permissions: bool
    plan_mode: bool

    def to_command(self, system_prompt_suffix: str = "") -> str:
        # `flags` is a JSON-cast column, so the ORM returns a native dict.
        # Tolerate a raw string too, in case an uncast value slips through.
        if isinstance(self.flags, str):
            try:
                flags = json.loads(self.flags)
            except (json.JSONDecodeError, ValueError):
                flags = {}
        else:
            flags = self.flags or {}

        system_prompt = self.system_prompt or ""
        if system_prompt_suffix:
            system_prompt = system_prompt + system_prompt_suffix
        if system_prompt.strip():
            prompt_file = f"/tmp/keera-agent-{self.id}.txt"
            with open(prompt_file, "w") as f:
                f.write(system_prompt.strip())
        else:
            prompt_file = None

        # Plan mode and skip-permissions are mutually exclusive; plan mode wins.
        # Outside plan mode, honor the per-agent skip-permissions toggle.
        max_turns = None
        if flags.get("max_turns"):
            try:
                max_turns = int(flags["max_turns"])
            except (TypeError, ValueError):
                pass

        enforce_permissions = self.plan_mode or not self.dangerously_skip_permissions
        command = ProviderCommand(
            model=self.model,
            worktree=f"agent-{self.id}" if getattr(self, "use_worktree", True) else None,
            continue_session=getattr(self, "has_session", False),
            system_prompt_file=prompt_file,
            allowed_tools=self.permissions_allow if enforce_permissions else [],
            disallowed_tools=self.permissions_deny if enforce_permissions else [],
            skip_permissions=self.dangerously_skip_permissions and not self.plan_mode,
            permission_mode="plan" if self.plan_mode else None,
            verbose=bool(flags.get("verbose")),
            max_turns=max_turns,
        )
        return providers.get(getattr(self, "provider", None) or "codex").build_command(command)
