import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.terminal.manager import TerminalManager
from app.terminal.terminal import Terminal

DRAIN_INTERVAL = 0.1
FINAL_OUTPUT_QUIET = 0.05
FINAL_OUTPUT_TIMEOUT = 0.5
POSIX_SHELLS = {"bash", "zsh", "sh"}
FALLBACK_SHELL = "/bin/sh"


def command_shell(shell: str | None) -> str:
    if shell and Path(shell).name in POSIX_SHELLS:
        return shell
    return FALLBACK_SHELL


@dataclass
class CommandRun:
    command_id: int
    cwd: str
    session_id: str
    terminal: Terminal
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    exit_code: int | None = None
    stopped: bool = False

    @property
    def id(self) -> str:
        return self.session_id

    @property
    def status(self) -> str:
        if self.terminal.is_alive():
            return "running"
        return "stopped" if self.stopped else "exited"


class CommandRunRegistry:
    def __init__(self, terminals: TerminalManager):
        self._terminals = terminals
        self._runs: dict[tuple[int, str], CommandRun] = {}
        self._watchers: dict[str, asyncio.Task] = {}
        self._locks: defaultdict[tuple[int, str], asyncio.Lock] = defaultdict(asyncio.Lock)

    def find(self, command_id: int, cwd: str) -> CommandRun | None:
        self._prune_removed_worktrees()
        return self._runs.get((command_id, cwd))

    def for_commands(self, command_ids: list[int]) -> list[CommandRun]:
        self._prune_removed_worktrees()
        return [run for (command_id, _), run in self._runs.items() if command_id in command_ids]

    async def start(self, command_id: int, command: str, cwd: str, env: dict) -> CommandRun:
        key = (command_id, cwd)
        async with self._locks[key]:
            previous = self._runs.pop(key, None)
            if previous is not None:
                await self._kill(previous)
            session_id = self._terminals.create(
                shell=command_shell(env.get("SHELL")), cwd=cwd, env=env, args=["-lc", command]
            )
            run = CommandRun(command_id, cwd, session_id, self._terminals.get(session_id))
            self._runs[key] = run
            self._watchers[session_id] = asyncio.create_task(self._watch(run))
            return run

    async def stop(self, command_id: int, cwd: str) -> CommandRun | None:
        async with self._locks[(command_id, cwd)]:
            run = self._runs.get((command_id, cwd))
            if run is not None:
                await self._kill(run)
            return run

    async def forget_command(self, command_id: int) -> None:
        for key in [key for key in self._runs if key[0] == command_id]:
            async with self._locks[key]:
                run = self._runs.pop(key, None)
                if run is not None:
                    await self._kill(run)
            if not self._locks[key].locked():
                del self._locks[key]

    def _prune_removed_worktrees(self) -> None:
        for key, run in list(self._runs.items()):
            if not run.terminal.is_alive() and not Path(run.cwd).is_dir():
                del self._runs[key]

    async def _kill(self, run: CommandRun) -> None:
        if run.terminal.is_alive():
            run.stopped = True
        watcher = self._watchers.pop(run.session_id, None)
        if watcher is not None:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)
        await self._terminals.close(run.session_id)

    async def _watch(self, run: CommandRun) -> None:
        output = run.terminal.subscribe()
        try:
            while run.terminal.is_alive():
                await asyncio.sleep(DRAIN_INTERVAL)
                _discard(output)
            await run.terminal.wait_until_quiet(FINAL_OUTPUT_QUIET, FINAL_OUTPUT_TIMEOUT)
            run.exit_code = run.terminal.returncode
        finally:
            run.terminal.unsubscribe(output)
        self._watchers.pop(run.session_id, None)
        await self._terminals.close(run.session_id)


def _discard(queue: asyncio.Queue) -> None:
    while not queue.empty():
        queue.get_nowait()
