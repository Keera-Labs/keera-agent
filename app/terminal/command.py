from app.ai.provider import ProviderCommand
from app.ai.providers.claude import ClaudeProvider


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

    def model(self, model: str) -> "ClaudeCommand":
        self._model = model
        return self

    def worktree(self, name: str) -> "ClaudeCommand":
        self._worktree = name
        return self

    def continue_session(self) -> "ClaudeCommand":
        self._continue = True
        return self

    def system_prompt_file(self, path: str) -> "ClaudeCommand":
        self._system_prompt_file = path
        return self

    def allowed_tools(self, tools: list[str]) -> "ClaudeCommand":
        self._allowed_tools = tools
        return self

    def disallowed_tools(self, tools: list[str]) -> "ClaudeCommand":
        self._disallowed_tools = tools
        return self

    def skip_permissions(self) -> "ClaudeCommand":
        self._skip_permissions = True
        return self

    def permission_mode(self, mode: str) -> "ClaudeCommand":
        self._permission_mode = mode
        return self

    def verbose(self) -> "ClaudeCommand":
        self._verbose = True
        return self

    def max_turns(self, n: int) -> "ClaudeCommand":
        self._max_turns = n
        return self

    def to_command(self) -> str:
        return ClaudeProvider().build_command(
            ProviderCommand(
                model=self._model,
                worktree=self._worktree,
                continue_session=self._continue,
                system_prompt_file=self._system_prompt_file,
                allowed_tools=self._allowed_tools or [],
                disallowed_tools=self._disallowed_tools or [],
                skip_permissions=self._skip_permissions,
                permission_mode=self._permission_mode,
                verbose=self._verbose,
                max_turns=self._max_turns,
            )
        )
