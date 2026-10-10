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
FINISHED_RUNS_PER_PROJECT = 20
POSIX_SHELLS = {"bash", "zsh", "sh"}
FALLBACK_SHELL = "/bin/sh"


def command_shell(shell: str | None) -> str:
    if shell and Path(shell).name in POSIX_SHELLS:
        return shell
    return FALLBACK_SHELL


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class CommandRunSpec:
    project_id: int
    label: str
    command: str
    command_id: int | None = None
    timeout_seconds: int | None = None


@dataclass
class CommandRun:
    spec: CommandRunSpec
    cwd: str
    session_id: str
    terminal: Terminal
    started_at: datetime = field(default_factory=_now)
    ended_at: datetime | None = None
    exit_code: int | None = None
    stopped: bool = False

    @property
    def id(self) -> str:
        return self.session_id

    @property
    def project_id(self) -> int:
        return self.spec.project_id

    @property
    def command_id(self) -> int | None:
        return self.spec.command_id

    @property
    def is_running(self) -> bool:
        return self.ended_at is None

    @property
    def status(self) -> str:
        if self.is_running:
            return "running"
        return "stopped" if self.stopped else "exited"

    @property
    def duration_ms(self) -> int | None:
        if self.ended_at is None:
            return None
        return round((self.ended_at - self.started_at).total_seconds() * 1000)

    def end(self) -> None:
        if self.ended_at is None:
            self.ended_at = _now()


class CommandRunRegistry:
    def __init__(self, terminals: TerminalManager):
        self._terminals = terminals
        self._runs: dict[str, CommandRun] = {}
        self._watchers: dict[str, asyncio.Task] = {}
        self._locks: defaultdict[tuple[int | None, str], asyncio.Lock] = defaultdict(asyncio.Lock)

    def get(self, run_id: str) -> CommandRun | None:
        self._prune()
        return self._runs.get(run_id)

    def find(self, command_id: int, cwd: str) -> CommandRun | None:
        self._prune()
        return next(
            (
                run
                for run in self._newest_first()
                if run.command_id == command_id and run.cwd == cwd
            ),
            None,
        )

    def for_project(self, project_id: int) -> list[CommandRun]:
        self._prune()
        return [run for run in self._newest_first() if run.project_id == project_id]

    async def start(self, spec: CommandRunSpec, cwd: str, env: dict) -> CommandRun:
        if spec.command_id is None:
            return self._spawn(spec, cwd, env)
        async with self._locks[(spec.command_id, cwd)]:
            previous = self.find(spec.command_id, cwd)
            if previous is not None:
                await self._kill(previous)
            return self._spawn(spec, cwd, env)

    async def stop(self, command_id: int, cwd: str) -> CommandRun | None:
        async with self._locks[(command_id, cwd)]:
            run = self.find(command_id, cwd)
            if run is not None:
                await self._kill(run)
            return run

    async def stop_run(self, run: CommandRun) -> None:
        async with self._locks[(run.command_id, run.cwd)]:
            await self._kill(run)

    async def forget_command(self, command_id: int) -> None:
        for run in [run for run in self._runs.values() if run.command_id == command_id]:
            key = (command_id, run.cwd)
            async with self._locks[key]:
                await self._kill(run)
                self._runs.pop(run.id, None)
            if not self._locks[key].locked():
                del self._locks[key]

    def _spawn(self, spec: CommandRunSpec, cwd: str, env: dict) -> CommandRun:
        session_id = self._terminals.create(
            shell=command_shell(env.get("SHELL")), cwd=cwd, env=env, args=["-lc", spec.command]
        )
        run = CommandRun(spec, cwd, session_id, self._terminals.get(session_id))
        self._runs[run.id] = run
        self._watchers[run.id] = asyncio.create_task(self._watch(run))
        self._prune()
        return run

    def _newest_first(self) -> list[CommandRun]:
        return list(reversed(self._runs.values()))

    def _prune(self) -> None:
        finished_per_project: defaultdict[int, int] = defaultdict(int)
        for run in self._newest_first():
            if run.is_running:
                continue
            finished_per_project[run.project_id] += 1
            over_limit = finished_per_project[run.project_id] > FINISHED_RUNS_PER_PROJECT
            if over_limit or not Path(run.cwd).is_dir():
                del self._runs[run.id]

    async def _kill(self, run: CommandRun) -> None:
        if run.is_running:
            run.stopped = True
            run.end()
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
            run.end()
            await run.terminal.wait_until_quiet(FINAL_OUTPUT_QUIET, FINAL_OUTPUT_TIMEOUT)
            run.exit_code = run.terminal.returncode
        finally:
            run.terminal.unsubscribe(output)
        self._watchers.pop(run.session_id, None)
        await self._terminals.close(run.session_id)


def _discard(queue: asyncio.Queue) -> None:
    while not queue.empty():
        queue.get_nowait()
