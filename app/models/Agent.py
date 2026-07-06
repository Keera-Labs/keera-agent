import json

from fastapi_startkit.masoniteorm import Model

from app.terminal.command import ClaudeCommand


class Agent(Model):
    __table__ = "agents"
    id: int
    flags: dict
    permissions_allow: list
    permissions_deny: list
    dangerously_skip_permissions: bool
    plan_mode: bool

    def to_command(self, system_prompt_suffix: str = "") -> str:
        try:
            flags = json.loads(self.flags) if self.flags else {}
        except (json.JSONDecodeError, TypeError):
            flags = {}

        cmd = ClaudeCommand()
        if getattr(self, "use_worktree", True):
            cmd.worktree(f"agent-{self.id}")

        if self.model:
            cmd.model(self.model)

        if getattr(self, "has_session", False):
            cmd.continue_session()

        system_prompt = self.system_prompt or ""
        if system_prompt_suffix:
            system_prompt = system_prompt + system_prompt_suffix
        if system_prompt.strip():
            prompt_file = f"/tmp/keera-agent-{self.id}.txt"
            with open(prompt_file, "w") as f:
                f.write(system_prompt.strip())
            cmd.system_prompt_file(prompt_file)

        # Plan mode and skip-permissions are mutually exclusive; plan mode wins.
        # Outside plan mode, honor the per-agent skip-permissions toggle.
        if self.plan_mode:
            cmd.permission_mode("plan")
        elif self.dangerously_skip_permissions:
            cmd.skip_permissions()
        if flags.get("verbose"):
            cmd.verbose()
        if flags.get("max_turns"):
            try:
                cmd.max_turns(int(flags["max_turns"]))
            except (TypeError, ValueError):
                pass

        # Allow/deny tool lists only matter when permissions are enforced.
        # They are dead weight only when --dangerously-skip-permissions is the
        # active flag — i.e. the skip toggle is on AND plan mode isn't overriding
        # it. Plan mode wins and enforces permissions, so the lists still apply
        # there even though the (independent) skip column may default to True.
        if self.plan_mode or not self.dangerously_skip_permissions:
            if self.permissions_allow:
                cmd.allowed_tools(self.permissions_allow)
            if self.permissions_deny:
                cmd.disallowed_tools(self.permissions_deny)

        return cmd.to_command()
