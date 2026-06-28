import shlex

PLAN_MODE_PREFIX = (
    "You are in PLAN-ONLY mode. Analyze and plan — do NOT write or edit any files, "
    "run commands, or execute any tool that modifies the filesystem or codebase. "
    "Only Read and Glob tools are permitted.\n\n"
)


class ClaudeCommand:
    def __init__(self):
        self._model: str | None = None
        self._worktree: str | None = None
        self._continue: bool = False
        self._system_prompt_file: str | None = None
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
        parts.append('--dangerously-skip-permissions')
        if self._verbose:
            parts.append('--verbose')
        if self._max_turns is not None:
            parts.append(f'--max-turns {self._max_turns}')
        return ' '.join(parts)
