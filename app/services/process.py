"""Non-blocking subprocess runner for git/gh calls made on behalf of a request."""

import asyncio
import os
import signal
from dataclasses import dataclass
from pathlib import Path

# Never wait on a credential prompt, editor or pager: a request would hang forever.
_ENV_OVERRIDES = {
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_EDITOR": "true",
    "GIT_PAGER": "cat",
    "GIT_OPTIONAL_LOCKS": "0",
    "GCM_INTERACTIVE": "never",
    "GH_PROMPT_DISABLED": "1",
    "GH_NO_UPDATE_NOTIFIER": "1",
    "NO_COLOR": "1",
}


class CommandError(Exception):
    """A command could not run or exited non-zero; `message` is safe to show the user."""

    def __init__(self, message: str, stderr: str = ""):
        super().__init__(message)
        self.message = message
        self.stderr = stderr


class CommandNotFound(CommandError):
    pass


@dataclass
class CommandResult:
    returncode: int
    stdout: bytes
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    @property
    def text(self) -> str:
        return self.stdout.decode("utf-8", "replace")

    @property
    def output(self) -> str:
        return "\n".join(part for part in (self.text.strip(), self.stderr.strip()) if part)


async def run_command(
    args: list[str], cwd: Path, timeout: float = 30, stdin: bytes | None = None
) -> CommandResult:
    if not cwd.is_dir():
        raise CommandError(f"Directory not found: {cwd}")
    try:
        # A new session gives the command its own process group, so on timeout the
        # whole tree (e.g. a git hook the command spawned) is killed, not just git.
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=cwd,
            env={**os.environ, **_ENV_OVERRIDES},
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
    except FileNotFoundError as e:
        raise CommandNotFound(f"{args[0]} is not installed") from e
    except (NotADirectoryError, PermissionError) as e:
        raise CommandError(f"Cannot run {Path(args[0]).name} in {cwd}") from e

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(stdin), timeout)
    except asyncio.TimeoutError as e:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()
        raise CommandError(f"{Path(args[0]).name} {args[1]} timed out after {timeout:g}s") from e

    return CommandResult(proc.returncode or 0, stdout, stderr.decode("utf-8", "replace"))
