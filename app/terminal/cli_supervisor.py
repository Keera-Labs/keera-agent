import asyncio
import logging
import re
import secrets
import time
from collections.abc import Callable

from app.actions.agent_startup import wait_for_agent_cli
from app.actions.relay_delivery import deliver_pending_relay_messages
from app.models.Agent import Agent
from app.terminal.readiness import claude_ready, is_cli_ready, mark_booting
from app.terminal.terminal import Terminal

logger = logging.getLogger("keera.agents")

# The agent CLI is typed into an interactive shell, so when it exits the shell
# silently takes the PTY back. Each launch line makes the shell print this OSC
# with the launch's own nonce once the CLI returns. The typed line only echoes
# it as backslash escapes, so the raw bytes can only come from the printf
# actually running, and output that merely looks like a marker (e.g. an agent
# printing one) can't match a launch it doesn't know the nonce of.
_EXIT_OSC = re.compile(rb"\x1b\]777;keera-cli-exited;([0-9a-f]{16})\x07")
_EXIT_OSC_LEN = len(b"\x1b]777;keera-cli-exited;") + 16 + 1

RESUME_NOTE = (
    "Your previous CLI session exited unexpectedly and has been resumed. "
    "Continue your current task from where you left off."
)


def with_exit_marker(command: str, nonce: str) -> str:
    return f"{command}; printf '\\033]777;keera-cli-exited;{nonce}\\007'"


class CliSupervisor:
    """Keeps an agent's CLI running in its shell.

    Relaunches it (with --continue) when it exits mid-session, and on request
    from the restart button. Only an exit while the CLI is ready counts: while
    it boots the session monitor owns restarts (e.g. the "No conversation
    found" fallback). The reader only records exits; relaunches and restarts
    run in their own tasks, one at a time under `_lock`, so an exit during a
    relaunch's boot is still seen.
    """

    max_restarts = 3
    restart_window = 600.0
    stop_timeout = 5.0
    interrupt_interval = 0.5
    max_interrupts = 4

    def __init__(
        self,
        agent_id: int,
        terminal: Terminal,
        session_id: str,
        build_cmd: Callable[[Agent], str],
    ):
        self.agent_id = agent_id
        self.terminal = terminal
        self.session_id = session_id
        self.build_cmd = build_cmd
        self._restarts: list[float] = []
        # Launches whose exit marker hasn't been seen yet, by nonce.
        self._running: dict[str, asyncio.Event] = {}
        self._lock = asyncio.Lock()
        self._restart_task: asyncio.Task | None = None
        self._handlers: set[asyncio.Task] = set()
        self.task: asyncio.Task | None = None

    @property
    def cli_running(self) -> bool:
        return bool(self._running)

    def launch_line(self, command: str) -> str:
        return self._new_launch(command)[0]

    def _new_launch(self, command: str) -> tuple[str, asyncio.Event]:
        """A launch line for `command` and the event its exit will set."""
        nonce = secrets.token_hex(8)
        exited = self._running[nonce] = asyncio.Event()
        return with_exit_marker(command, nonce), exited

    async def run(self) -> None:
        queue = self.terminal.subscribe()
        tail = b""
        try:
            while self.terminal.is_alive():
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                chunk = tail + data
                end = 0
                for match in _EXIT_OSC.finditer(chunk):
                    end = match.end()
                    self._record_exit(match.group(1).decode())
                # Keep what could be the start of a marker split across reads.
                tail = chunk[max(end, len(chunk) - (_EXIT_OSC_LEN - 1)) :]
        finally:
            self.terminal.unsubscribe(queue)
            for handler in self._handlers:
                handler.cancel()
            if _supervisors.get(self.session_id) is self:
                del _supervisors[self.session_id]

    def _record_exit(self, nonce: str) -> None:
        exited = self._running.pop(nonce, None)
        if exited is None:
            return
        exited.set()
        handler = asyncio.create_task(self.on_cli_exit())
        self._handlers.add(handler)
        handler.add_done_callback(self._handlers.discard)

    async def on_cli_exit(self) -> None:
        async with self._lock:
            # Booting exits belong to the session monitor, or to the relaunch in
            # progress; a newer launch may also have replaced this CLI already.
            if self.cli_running or not is_cli_ready(self.session_id):
                return
            # Hold relay messages: until the CLI is back they would run as shell commands.
            ready_event = mark_booting(self.session_id)
            while True:
                agent = await self._live_agent()
                if agent is None:
                    self._stop_supervising()
                    return
                now = time.monotonic()
                self._restarts = [t for t in self._restarts if now - t < self.restart_window]
                if len(self._restarts) >= self.max_restarts:
                    activity = "CLI keeps exiting; use Restart to relaunch it"
                    logger.warning("Agent %s: %s", self.agent_id, activity)
                    await Agent.where("id", self.agent_id).update({"current_activity": activity})
                    return
                self._restarts.append(now)
                logger.warning("Agent %s: CLI exited unexpectedly, relaunching it", self.agent_id)
                if await self._launch(agent, ready_event, RESUME_NOTE) is not False:
                    return

    async def restart(self) -> bool:
        """Stop the CLI if it is running and launch it again (the restart button).

        Presses from several tabs while one restart is in flight share its result.
        """
        if self._restart_task is None or self._restart_task.done():
            self._restart_task = asyncio.create_task(self._restart())
        return await asyncio.shield(self._restart_task)

    async def _restart(self) -> bool:
        async with self._lock:
            agent = await self._live_agent()
            if agent is None:
                return False
            previous = claude_ready.get(self.session_id)
            # Booting also turns the stopped CLI's own exit into a no-op for on_cli_exit.
            ready_event = mark_booting(self.session_id)
            if self.cli_running and not await self._stop_cli():
                logger.warning("Agent %s: CLI did not stop for a restart", self.agent_id)
                # The CLI is as it was, so its readiness is too (still booting stays booting).
                if previous is None:
                    claude_ready.pop(self.session_id, None)
                else:
                    claude_ready[self.session_id] = previous
                return False
            self._restarts.clear()
            return bool(await self._launch(agent, ready_event, None))

    async def _live_agent(self) -> Agent | None:
        agent = await Agent.find(self.agent_id)
        if (
            not agent
            or getattr(agent, "deleted_at", None)
            or agent.session_id != self.session_id
            or not self.terminal.is_alive()
        ):
            return None
        return agent

    def _stop_supervising(self) -> None:
        if self.task:
            self.task.cancel()

    async def _stop_cli(self) -> bool:
        # CLIs exit on a second Ctrl-C; the first may only cancel a running turn.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.stop_timeout
        interrupts = 0
        while self.cli_running:
            if loop.time() >= deadline:
                return False
            if interrupts < self.max_interrupts:
                await self.terminal.write(b"\x03")
                interrupts += 1
            await asyncio.sleep(self.interrupt_interval)
        return True

    async def _launch(
        self, agent: Agent, ready_event: asyncio.Event, note: str | None
    ) -> bool | None:
        """Launch the CLI and release held messages once it is ready.

        Returns False if it exited while booting, None if a newer launch took
        over the session meanwhile (that launch delivers its own backlog).
        """
        line, exited = self._new_launch(self.build_cmd(agent))
        await self.terminal.write(line.encode() + b"\r")

        booted = asyncio.create_task(wait_for_agent_cli(self.terminal, self.agent_id))
        died = asyncio.create_task(exited.wait())
        await asyncio.wait({booted, died}, return_when=asyncio.FIRST_COMPLETED)
        for waiter in (booted, died):
            waiter.cancel()
        await asyncio.gather(booted, died, return_exceptions=True)

        if claude_ready.get(self.session_id) is not ready_event:
            return None
        if exited.is_set():
            logger.warning("Agent %s: relaunched CLI exited while booting", self.agent_id)
            return False
        if note:
            await self.terminal.send(note)
        ready_event.set()
        await deliver_pending_relay_messages(self.agent_id)
        return True


_supervisors: dict[str, CliSupervisor] = {}


def supervise_cli(
    agent_id: int, terminal: Terminal, session_id: str, build_cmd: Callable[[Agent], str]
) -> CliSupervisor:
    """Supervise a session's CLI; launch it with the returned supervisor's `launch_line`."""
    supervisor = CliSupervisor(agent_id, terminal, session_id, build_cmd)
    # The registry also keeps the task alive: the loop only holds tasks weakly.
    _supervisors[session_id] = supervisor
    supervisor.task = asyncio.create_task(supervisor.run())
    return supervisor


async def launch_cli(terminal: Terminal, session_id: str, command: str) -> None:
    """Type the CLI launch line into the session's shell, keeping it supervised."""
    supervisor = _supervisors.get(session_id)
    if supervisor:
        line = supervisor.launch_line(command)
    else:
        line = with_exit_marker(command, secrets.token_hex(8))
    await terminal.write(line.encode() + b"\r")


async def restart_cli(session_id: str) -> bool:
    supervisor = _supervisors.get(session_id)
    return bool(supervisor) and await supervisor.restart()
