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
    """Relaunches an agent's CLI (with --continue) when it exits mid-session.

    Only an exit while the CLI is ready counts: while it boots the session
    monitor owns restarts (e.g. the "No conversation found" fallback).
    """

    max_restarts = 3
    restart_window = 600.0

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
                if not await self.on_cli_exit():
                    return
        finally:
            self.terminal.unsubscribe(queue)

    async def on_cli_exit(self) -> bool:
        """Handle one CLI exit; returns False once supervision should stop."""
        if not is_cli_ready(self.session_id):
            return True
        # Hold relay messages: until the CLI is back they would run as shell commands.
        ready_event = mark_booting(self.session_id)

        agent = await Agent.find(self.agent_id)
        if (
            not agent
            or getattr(agent, "deleted_at", None)
            or agent.session_id != self.session_id
            or not self.terminal.is_alive()
        ):
            return False

        now = time.monotonic()
        self._restarts = [t for t in self._restarts if now - t < self.restart_window]
        if len(self._restarts) >= self.max_restarts:
            activity = "CLI keeps exiting; open the agent's terminal to relaunch it"
            logger.warning("Agent %s: %s", self.agent_id, activity)
            await Agent.where("id", self.agent_id).update({"current_activity": activity})
            return False
        self._restarts.append(now)

        logger.warning("Agent %s: CLI exited unexpectedly, relaunching it", self.agent_id)
        command = with_exit_marker(self.build_cmd(agent))
        await self.terminal.write(command.encode() + b"\r")
        await wait_for_agent_cli(self.terminal, self.agent_id)
        # A newer (re)launch took over the session meanwhile; it delivers its own backlog.
        if claude_ready.get(self.session_id) is not ready_event:
            return True
        await self.terminal.send(RESUME_NOTE)
        ready_event.set()
        await deliver_pending_relay_messages(self.agent_id)
        return True


_supervisors: set[asyncio.Task] = set()


def supervise_cli(
    agent_id: int, terminal: Terminal, session_id: str, build_cmd: Callable[[Agent], str]
) -> asyncio.Task:
    task = asyncio.create_task(CliSupervisor(agent_id, terminal, session_id, build_cmd).run())
    # The loop holds tasks weakly; keep a reference until the session ends.
    _supervisors.add(task)
    task.add_done_callback(_supervisors.discard)
    return task
