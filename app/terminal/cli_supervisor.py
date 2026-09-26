import asyncio
import logging
import time
from collections.abc import Callable

from app.actions.agent_startup import wait_for_agent_cli
from app.actions.relay_delivery import deliver_pending_relay_messages
from app.models.Agent import Agent
from app.terminal.readiness import claude_ready, is_cli_ready, mark_booting
from app.terminal.terminal import Terminal

logger = logging.getLogger("keera.agents")

# The agent CLI is typed into an interactive shell, so when it exits the shell
# silently takes the PTY back. The launch line makes the shell print this OSC
# once the CLI returns. The typed line only echoes it as backslash escapes, so
# the raw bytes can only come from the printf actually running.
_EXIT_OSC = b"\x1b]777;keera-cli-exited\x07"

RESUME_NOTE = (
    "Your previous CLI session exited unexpectedly and has been resumed. "
    "Continue your current task from where you left off."
)


def with_exit_marker(command: str) -> str:
    return f"{command}; printf '\\033]777;keera-cli-exited\\007'"


class CliSupervisor:
    """Keeps an agent's CLI running in its shell.

    Relaunches it (with --continue) when it exits mid-session, and on request
    from the restart button. Only an exit while the CLI is ready counts: while
    it boots the session monitor owns restarts (e.g. the "No conversation
    found" fallback).
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
        # Counted rather than flagged: a launch and the previous CLI's exit
        # marker can be observed in either order. The caller launches right
        # after supervising, hence one launch up front.
        self._launches = 1
        self._exits = 0
        self.task: asyncio.Task | None = None

    @property
    def cli_running(self) -> bool:
        return self._launches > self._exits

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
                if _EXIT_OSC not in chunk:
                    tail = chunk[-len(_EXIT_OSC) :]
                    continue
                tail = b""
                self._exits += chunk.count(_EXIT_OSC)
                if not await self.on_cli_exit():
                    return
        finally:
            self.terminal.unsubscribe(queue)
            if _supervisors.get(self.session_id) is self:
                del _supervisors[self.session_id]

    async def on_cli_exit(self) -> bool:
        """Handle one CLI exit; returns False once supervision should stop."""
        if not is_cli_ready(self.session_id):
            return True
        # Hold relay messages: until the CLI is back they would run as shell commands.
        ready_event = mark_booting(self.session_id)

        agent = await self._live_agent()
        if agent is None:
            return False

        now = time.monotonic()
        self._restarts = [t for t in self._restarts if now - t < self.restart_window]
        if len(self._restarts) >= self.max_restarts:
            activity = "CLI keeps exiting; use Restart to relaunch it"
            logger.warning("Agent %s: %s", self.agent_id, activity)
            await Agent.where("id", self.agent_id).update({"current_activity": activity})
            # Keep watching: the restart button relaunches through this supervisor.
            return True
        self._restarts.append(now)

        logger.warning("Agent %s: CLI exited unexpectedly, relaunching it", self.agent_id)
        await self._launch(agent, ready_event, RESUME_NOTE)
        return True

    async def restart(self) -> bool:
        """Stop the CLI if it is running and launch it again (the restart button)."""
        agent = await self._live_agent()
        if agent is None:
            return False
        # Booting also turns the stopped CLI's own exit marker into a no-op.
        ready_event = mark_booting(self.session_id)
        if self.cli_running and not await self._stop_cli():
            logger.warning("Agent %s: CLI did not stop for a restart", self.agent_id)
            ready_event.set()
            return False
        self._restarts.clear()
        await self._launch(agent, ready_event, None)
        return True

    def note_launch(self) -> None:
        self._launches += 1

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

    async def _launch(self, agent: Agent, ready_event: asyncio.Event, note: str | None) -> None:
        await launch_cli(self.terminal, self.session_id, self.build_cmd(agent))
        await wait_for_agent_cli(self.terminal, self.agent_id)
        # A newer (re)launch took over the session meanwhile; it delivers its own backlog.
        if claude_ready.get(self.session_id) is not ready_event:
            return
        if note:
            await self.terminal.send(note)
        ready_event.set()
        await deliver_pending_relay_messages(self.agent_id)


_supervisors: dict[str, CliSupervisor] = {}


def supervise_cli(
    agent_id: int, terminal: Terminal, session_id: str, build_cmd: Callable[[Agent], str]
) -> asyncio.Task:
    supervisor = CliSupervisor(agent_id, terminal, session_id, build_cmd)
    # The registry also keeps the task alive: the loop only holds tasks weakly.
    _supervisors[session_id] = supervisor
    supervisor.task = asyncio.create_task(supervisor.run())
    return supervisor.task


async def launch_cli(terminal: Terminal, session_id: str, command: str) -> None:
    """Type the CLI launch line into the session's shell, keeping it supervised."""
    supervisor = _supervisors.get(session_id)
    if supervisor:
        supervisor.note_launch()
    await terminal.write(with_exit_marker(command).encode() + b"\r")


async def restart_cli(session_id: str) -> bool:
    supervisor = _supervisors.get(session_id)
    return bool(supervisor) and await supervisor.restart()
