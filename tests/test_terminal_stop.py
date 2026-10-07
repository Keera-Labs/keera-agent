"""Regression tests for Terminal.stop()/aclose() killing everything the terminal started.

The agent CLI is typed into an interactive shell whose job control puts each
command in its own process group, so teardown must take down every group under
the terminal — not just the shell — or the CLI is orphaned (reparented to init).
Teardown can take seconds, so the async path must keep the event loop responsive.
"""

import asyncio
import os
import subprocess
import time
import unittest

from app.terminal.terminal import Terminal, _process_groups


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

    def assert_all_gone(self, pids: list[int]) -> None:
        for pid in pids:
            self.assertTrue(
                _wait_until(lambda: not _is_running(pid), 2.0), f"{pid} survived teardown"
            )

    async def test_aclose_kills_foreground_and_background_children(self):
        pids = await self._run("sleep 4321 & sleep 4322", "sleep 4321", "sleep 4322")
        shell_pid = self.terminal.pid

        await self.terminal.aclose()

        self.assert_all_gone([shell_pid, *pids])

    async def test_blocking_stop_kills_children(self):
        pids = await self._run("sleep 4325 &", "sleep 4325")

        self.terminal.stop()

        self.assert_all_gone(pids)

    async def test_aclose_sigkills_children_that_ignore_sigterm(self):
        self.terminal.stop_grace = 0.2
        # Ignored signals are inherited across exec, so sleep ignores TERM and HUP too.
        pids = await self._run("trap '' TERM HUP; sleep 4323", "sleep 4323")

        await self.terminal.aclose()

        self.assert_all_gone(pids)

    async def test_event_loop_stays_responsive_during_aclose(self):
        # A SIGTERM-immune child forces the full grace period, so teardown takes
        # about a second — the loop must keep running other tasks throughout.
        self.terminal.stop_grace = 1.0
        pids = await self._run("trap '' TERM HUP; sleep 4326", "sleep 4326")

        ticks: list[float] = []

        async def ticker():
            while True:
                ticks.append(time.monotonic())
                await asyncio.sleep(0.01)

        task = asyncio.create_task(ticker())
        await asyncio.sleep(0.05)
        started = time.monotonic()
        await self.terminal.aclose()
        elapsed = time.monotonic() - started
        task.cancel()

        during = [t for t in ticks if t >= started]
        gaps = [b - a for a, b in zip(during, during[1:])]
        self.assertGreaterEqual(elapsed, 0.9, "teardown should have waited out the grace period")
        self.assertGreater(len(during), 30)
        self.assertLess(max(gaps), 0.2, "event loop was blocked during aclose()")
        self.assert_all_gone(pids)

    async def test_concurrent_teardown_is_safe(self):
        pids = await self._run("sleep 4327 &", "sleep 4327")

        results = await asyncio.gather(
            self.terminal.aclose(),
            self.terminal.aclose(),
            asyncio.to_thread(self.terminal.stop),
            return_exceptions=True,
        )

        self.assertEqual(results, [None, None, None])
        self.assertIsNone(self.terminal.master_fd)
        self.assertFalse(self.terminal.is_alive())
        self.assert_all_gone(pids)

    async def test_teardown_after_shell_exited_is_safe(self):
        await self.terminal.write(b"exit\n")
        self.assertTrue(_wait_until(lambda: not self.terminal.is_alive()))

        await self.terminal.aclose()
        await self.terminal.aclose()
        self.terminal.stop()

        self.assertFalse(self.terminal.is_alive())

    async def test_teardown_leaves_the_calling_process_group_alone(self):
        await self._run("sleep 4324 &", "sleep 4324")

        groups = _process_groups(self.terminal.pid, self.terminal.master_fd)
        self.assertNotIn(os.getpgrp(), groups)
        await self.terminal.aclose()

        os.killpg(os.getpgrp(), 0)
