from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(slots=True)
class ProviderCommand:
    """Provider-neutral options used to start an interactive AI session."""

    model: str | None = None
    worktree: str | None = None
    continue_session: bool = False
    system_prompt_file: str | None = None
    allowed_tools: list[str] = field(default_factory=list)
    disallowed_tools: list[str] = field(default_factory=list)
    skip_permissions: bool = False
    permission_mode: str | None = None
    verbose: bool = False
    max_turns: int | None = None


class Provider(ABC):
    """Contract implemented by each supported interactive AI CLI."""

    slug: str
    display_name: str

    @abstractmethod
    def build_command(self, command: ProviderCommand) -> str:
        """Render a shell command that starts or resumes a provider session."""
