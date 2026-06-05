import json

from fastapi_startkit.masoniteorm import Model

from app.terminal.command import ClaudeCommand, PLAN_MODE_PREFIX


class Agent(Model):
    __table__ = "agents"
    id: int

    def to_command(self, system_prompt_suffix: str = '') -> str:
        task_id = getattr(self, 'task_id', None)
        worktree = f'agent-{task_id}' if task_id else f'agent-{self.id}'

        try:
            flags = json.loads(self.flags) if self.flags else {}
        except (json.JSONDecodeError, TypeError):
            flags = {}

        cmd = ClaudeCommand().worktree(worktree)

        if self.model:
            cmd.model(self.model)

        if getattr(self, 'has_session', False):
            cmd.continue_session()

        system_prompt = self.system_prompt or ''
        if flags.get('plan_mode'):
            system_prompt = PLAN_MODE_PREFIX + system_prompt
        if system_prompt_suffix:
            system_prompt = system_prompt + system_prompt_suffix
        if system_prompt.strip():
            prompt_file = f'/tmp/keera-agent-{self.id}.txt'
            with open(prompt_file, 'w') as f:
                f.write(system_prompt.strip())
            cmd.system_prompt_file(prompt_file)

        if flags.get('dangerously_skip_permissions'):
            cmd.skip_permissions()
        if flags.get('verbose'):
            cmd.verbose()
        if flags.get('max_turns'):
            try:
                cmd.max_turns(int(flags['max_turns']))
            except (TypeError, ValueError):
                pass

        try:
            allow = json.loads(self.permissions_allow) if getattr(self, 'permissions_allow', None) else []
            if allow:
                cmd.allowed_tools(allow)
        except (json.JSONDecodeError, TypeError):
            pass

        try:
            deny = json.loads(self.permissions_deny) if getattr(self, 'permissions_deny', None) else []
            if deny:
                cmd.disallowed_tools(deny)
        except (json.JSONDecodeError, TypeError):
            pass

        return cmd.to_command()
