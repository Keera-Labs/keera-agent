import shlex


class ClaudeCommand:
    def __init__(self):
        self._model: str | None = None
        self._worktree: str | None = None
        self._continue: bool = False
        self._system_prompt_file: str | None = None
        self._allowed_tools: list[str] | None = None
        self._disallowed_tools: list[str] | None = None
        self._skip_permissions: bool = False
        self._permission_mode: str | None = None
        self._verbose: bool = False
        self._max_turns: int | None = None

    def model(self, model: str) -> 'ClaudeCommand':
        self._model = model
        return self

    def worktree(self, name: str) -> 'ClaudeCommand':
        self._worktree = name
        return self

    def continue_session(self) -> 'ClaudeCommand':
        self._continue = True
        return self

    def system_prompt_file(self, path: str) -> 'ClaudeCommand':
        self._system_prompt_file = path
        return self

    def allowed_tools(self, tools: list[str]) -> 'ClaudeCommand':
        self._allowed_tools = tools
        return self

    def disallowed_tools(self, tools: list[str]) -> 'ClaudeCommand':
        self._disallowed_tools = tools
        return self

    def skip_permissions(self) -> 'ClaudeCommand':
        self._skip_permissions = True
        return self

    def permission_mode(self, mode: str) -> 'ClaudeCommand':
        self._permission_mode = mode
        return self

    def verbose(self) -> 'ClaudeCommand':
        self._verbose = True
        return self

    def max_turns(self, n: int) -> 'ClaudeCommand':
        self._max_turns = n
        return self

    def to_command(self) -> str:
        parts = ['claude']
        if self._worktree:
            parts.append(f'--worktree {shlex.quote(self._worktree)}')
        if self._continue:
            parts.append('--continue')
        if self._system_prompt_file:
            parts.append(f'--system-prompt "$(cat {shlex.quote(self._system_prompt_file)})"')
        if self._model:
            parts.append(f'--model {shlex.quote(self._model)}')
        if self._allowed_tools:
            parts.append(f'--allowedTools {shlex.quote(",".join(self._allowed_tools))}')
        if self._disallowed_tools:
            parts.append(f'--disallowedTools {shlex.quote(",".join(self._disallowed_tools))}')
        if self._permission_mode:
            parts.append(f'--permission-mode {shlex.quote(self._permission_mode)}')
        if self._skip_permissions:
            parts.append('--dangerously-skip-permissions')
        if self._verbose:
            parts.append('--verbose')
        if self._max_turns is not None:
            parts.append(f'--max-turns {self._max_turns}')
        return ' '.join(parts)
