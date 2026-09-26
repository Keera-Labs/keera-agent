"""Regression tests for Terminal.stop() killing everything the terminal started.

The agent CLI is typed into an interactive shell whose job control puts each
command in its own process group, so stop() must take down every group under
the terminal — not just the shell — or the CLI is orphaned (reparented to init).
"""

import os
import subprocess
import time
import unittest

from app.terminal.terminal import Terminal


def _descendants(root_pid: int) -> dict[int, str]:
    out = subprocess.run(
        ["ps", "-A", "-o", "pid=,ppid=,command="], capture_output=True, text=True, check=True
    ).stdout
    children: dict[int, list[tuple[int, str]]] = {}
    for line in out.splitlines():
        pid, ppid, command = line.split(None, 2)
        children.setdefault(int(ppid), []).append((int(pid), command))

    found: dict[int, str] = {}
    pending = [root_pid]
    while pending:
        for pid, command in children.get(pending.pop(), []):
            found[pid] = command
            pending.append(pid)
    return found


def _is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # An orphan that already died may linger as a zombie until init reaps it.
    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True)
    return bool(state.stdout.strip()) and not state.stdout.strip().startswith("Z")


def _wait_until(predicate, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


class TestTerminalStop(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.terminal = Terminal(shell="/bin/sh", cwd="/tmp")
        self.terminal.start()
        self.addCleanup(self.terminal.stop)

    async def _run(self, command: str, *markers: str) -> list[int]:
        """Type `command` into the shell and return the pids whose command lines match markers."""
        await self.terminal.write(command.encode() + b"\n")

        def started() -> dict[int, str]:
            procs = _descendants(self.terminal.pid)
            return {
                pid: cmd for pid, cmd in procs.items() if any(m == cmd.strip() for m in markers)
            }

        self.assertTrue(
            _wait_until(lambda: len(started()) == len(markers)), "children never started"
        )
        return list(started())

    async def test_stop_kills_foreground_and_background_children(self):
        pids = await self._run("sleep 4321 & sleep 4322", "sleep 4321", "sleep 4322")
        shell_pid = self.terminal.pid

        self.terminal.stop()

        for pid in [shell_pid, *pids]:
            self.assertTrue(
                _wait_until(lambda: not _is_running(pid), 2.0), f"{pid} survived stop()"
            )

    async def test_stop_sigkills_children_that_ignore_sigterm(self):
        self.terminal.stop_grace = 0.2
        # Ignored signals are inherited across exec, so sleep ignores TERM and HUP too.
        (pid,) = await self._run("trap '' TERM HUP; sleep 4323", "sleep 4323")

        self.terminal.stop()

        self.assertTrue(
            _wait_until(lambda: not _is_running(pid), 2.0), "SIGTERM-immune child survived"
        )

    async def test_stop_after_shell_exited_is_safe(self):
        await self.terminal.write(b"exit\n")
        self.assertTrue(_wait_until(lambda: not self.terminal.is_alive()))

        self.terminal.stop()
        self.terminal.stop()

        self.assertFalse(self.terminal.is_alive())

    async def test_stop_leaves_the_calling_process_group_alone(self):
        await self._run("sleep 4324 &", "sleep 4324")

        self.assertNotIn(os.getpgrp(), self.terminal._process_groups())
        self.terminal.stop()

        os.killpg(os.getpgrp(), 0)
