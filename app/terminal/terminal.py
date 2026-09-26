import asyncio
import codecs
import fcntl
import os
import pty as _pty
import re
import signal
import struct
import subprocess
import termios
import time


def _with_color_env(env: dict) -> dict:
    # The PTY is always rendered by xterm.js (a 256-color, truecolor-capable
    # frontend), so advertise a color terminal regardless of how the server
    # was launched. When booted from a GUI process (the pywebview desktop
    # build) the parent environment has no TERM/COLORTERM, which makes the
    # claude CLI fall back to monochrome; setting these restores color.
    env.setdefault("TERM", "xterm-256color")
    env.setdefault("COLORTERM", "truecolor")
    return env


PASTE_START = b"\x1b[200~"
PASTE_END = b"\x1b[201~"

# CLI startup dialogs that wait for a choice. Enter picks the highlighted
# option (codex's update prompt defaults to running a global npm install), so
# nothing is submitted while one is on screen. A dialog counts only when it is
# fully drawn — one of its options followed by its key-hint footer — so the
# same words quoted in replayed conversation history don't match.
DIALOG_OPTIONS = re.compile(
    r"Yes, I trust this folder|Yes, I accept|Trust and continue|Skip until next version"
)
DIALOG_FOOTERS = re.compile(
    r"Enter to confirm · Esc to (?:cancel|exit)|enter continue · esc quit|Press enter to continue"
)
_DIALOG_MARKERS = re.compile(f"{DIALOG_OPTIONS.pattern}|{DIALOG_FOOTERS.pattern}")
# How far before its footer a dialog's option may appear.
_DIALOG_SPAN = 400
# Visible characters drawn after the last dialog text before the dialog counts as
# replaced by other screen content (e.g. the CLI's main UI once it is answered).
_DIALOG_RELEASE_CHARS = 200
_ESCAPES = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b.")
_PARTIAL_ESCAPE = re.compile(rb"\x1b(?:\[[0-9;?<>=]*[ -/]*|\][^\x07\x1b]*)?\Z")
# Plain text kept from previous chunks so a dialog split across reads still matches.
_TAIL_CHARS = _DIALOG_SPAN + 100


def _visible_len(text: str) -> int:
    return len(text) - text.count(" ")


def _drawn_dialog(text: str, fresh: int) -> str | None:
    """The option of a dialog whose footer was just drawn, if one is on screen."""
    for footer in reversed(list(DIALOG_FOOTERS.finditer(text))):
        if footer.end() <= fresh:
            break
        options = list(
            DIALOG_OPTIONS.finditer(text, max(0, footer.start() - _DIALOG_SPAN), footer.start())
        )
        if options:
            return options[-1].group(0)
    return None


class _PlainText:
    """Turns PTY output into plain text, carrying escapes and UTF-8 split across reads."""

    def __init__(self):
        self._pending = b""
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

    def feed(self, data: bytes) -> str:
        data = self._pending + data
        partial = _PARTIAL_ESCAPE.search(data)
        cut = partial.start() if partial else len(data)
        data, self._pending = data[:cut], data[cut:]
        # Escapes become spaces: TUIs often move the cursor instead of printing blanks.
        text = self._decoder.decode(_ESCAPES.sub(b" ", data))
        return re.sub(r"\s+", " ", text)


def _descendant_process_groups(root_pid: int) -> set[int]:
    try:
        ps = subprocess.run(
            ["ps", "-A", "-o", "pid=,ppid=,pgid="],
            capture_output=True,
            text=True,
            check=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return set()

    children: dict[int, list[tuple[int, int]]] = {}
    for line in ps.stdout.splitlines():
        fields = line.split()
        if len(fields) == 3 and all(f.isdigit() for f in fields):
            pid, ppid, pgid = map(int, fields)
            children.setdefault(ppid, []).append((pid, pgid))

    groups: set[int] = set()
    pending = [root_pid]
    while pending:
        for pid, pgid in children.get(pending.pop(), []):
            groups.add(pgid)
            pending.append(pid)
    return groups


def _signal_groups(groups: set[int], sig: signal.Signals) -> None:
    for pgid in groups:
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            pass


def _wait_for_groups(groups: set[int], timeout: float) -> set[int]:
    """Wait up to `timeout` for the groups to empty; return the ones still alive."""
    deadline = time.monotonic() + timeout
    alive = set(groups)
    while True:
        for pgid in list(alive):
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError):
                alive.discard(pgid)
        if not alive or time.monotonic() >= deadline:
            return alive
        time.sleep(0.02)


class Terminal:
    # send() waits at most echo_timeout for the CLI to echo a paste, and treats
    # echo_settle seconds of silence as the echo having finished rendering.
    echo_timeout = 3.0
    echo_settle = 0.3
    # How long stop() lets the CLI exit on SIGTERM before SIGKILLing it.
    stop_grace = 1.0
    # How long wait_for_cli_ready() holds for an unanswered startup dialog.
    dialog_timeout = 120.0

    def __init__(
        self,
        shell: str | None = None,
        cwd: str | None = None,
        cols: int = 80,
        rows: int = 24,
        env: dict | None = None,
    ):
        self._shell = shell or os.environ.get("SHELL", "/bin/bash")
        self._cwd = cwd or os.path.expanduser("~")
        self._cols = cols
        self._rows = rows
        self._env = _with_color_env(env or os.environ.copy())
        self._proc: subprocess.Popen | None = None
        self.master_fd: int | None = None
        self._write_lock = asyncio.Lock()
        self._send_lock = asyncio.Lock()
        self._output_seq = 0
        self._output_tail = ""
        # Dialogs are only looked for while the CLI boots, so a reply that
        # quotes one mid-session can't block delivery.
        self._booting = True
        # The option text of the startup dialog on screen, if any. Only output
        # clears it: resizes and terminal query replies also arrive as input.
        self.startup_prompt: str | None = None
        self._chars_since_dialog = 0
        self._plain = _PlainText()

    def start(self) -> None:
        master_fd, slave_fd = _pty.openpty()
        self._set_size(master_fd, self._rows, self._cols)

        proc = subprocess.Popen(
            [self._shell],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True,
            preexec_fn=os.setsid,
            cwd=self._cwd,
            env=self._env,
        )
        os.close(slave_fd)

        self._proc = proc
        self.master_fd = master_fd

    def stop(self) -> None:
        groups = self._process_groups() if self._proc else set()
        _signal_groups(groups, signal.SIGTERM)
        # Close the master before reaping the shell: a session leader's exit waits for
        # unread tty output to drain, and nothing reads the master once we're stopping.
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        if self._proc:
            # Interactive shells ignore SIGTERM, and the shell holds no state worth a
            # graceful exit; reaping it also stops its zombie keeping its group "alive".
            try:
                self._proc.kill()
                self._proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
            _signal_groups(_wait_for_groups(groups, self.stop_grace), signal.SIGKILL)
            self._proc = None

    async def write(self, data: bytes) -> None:
        if self.master_fd is None or not data:
            return

        # The master fd is non-blocking (registered with loop.add_reader by the
        # websocket bridge), so a single os.write() can (a) write fewer bytes
        # than requested — silently dropping the tail — or (b) raise EAGAIN when
        # the PTY buffer is full. Drain the whole payload, waiting for the fd to
        # become writable between chunks. The lock serializes concurrent writers
        # so an interleaved caller (e.g. the trailing submit "\r") can't splice
        # bytes into the middle of another message.
        async with self._write_lock:
            await self._drain_write(data)

    async def _drain_write(self, data: bytes) -> None:
        fd = self.master_fd
        if fd is None:
            return
        loop = asyncio.get_running_loop()
        view = memoryview(data)
        offset = 0
        while offset < len(view):
            try:
                offset += os.write(fd, view[offset:])
            except BlockingIOError:
                await self._wait_writable(loop, fd)
            except InterruptedError:
                # Signal interrupted the syscall (EINTR) — retry the remainder.
                continue
            except OSError:
                # fd closed or child gone — nothing more we can deliver.
                return

    def mark_output(self, data: bytes) -> None:
        """Record PTY output; the reader bridge calls this per chunk."""
        self._output_seq += 1
        if not self._booting:
            return
        plain = self._plain.feed(data)
        if self._output_tail.endswith(" "):
            plain = plain.lstrip(" ")
        text = self._output_tail + plain
        fresh = len(self._output_tail)
        markers = [m for m in _DIALOG_MARKERS.finditer(text) if m.end() > fresh]
        if markers:
            self._chars_since_dialog = _visible_len(text[markers[-1].end() :])
            dialog = _drawn_dialog(text, fresh)
            if dialog:
                self.startup_prompt = dialog
        else:
            self._chars_since_dialog += _visible_len(plain)
        if self._chars_since_dialog > _DIALOG_RELEASE_CHARS:
            self.startup_prompt = None
        self._output_tail = text[-_TAIL_CHARS:]

    async def send(self, message: str) -> None:
        """Type `message` into the CLI and submit it.

        The text goes in as a bracketed paste so embedded newlines stay part of
        the message instead of acting as keystrokes. Enter is only sent once the
        CLI has echoed the paste: a CLI that is still busy booting reads all
        pending stdin in one chunk, and when the text and the CR land in the
        same read the CR is swallowed as part of the paste — the message then
        sits unsubmitted in the input box until the next message's Enter.
        """
        body = message.encode().rstrip(b"\r\n").replace(PASTE_END, b"")
        async with self._send_lock:
            if body:
                seen = self._output_seq
                await self.write(PASTE_START + body + PASTE_END)
                await self._wait_for_echo(seen)
            await self.write(b"\r")

    async def _wait_for_echo(self, seen: int) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.echo_timeout
        while self._output_seq == seen and loop.time() < deadline:
            await asyncio.sleep(0.02)
        await self.wait_until_quiet(self.echo_settle, max(0.0, deadline - loop.time()))

    async def wait_for_cli_ready(
        self,
        min_wait: float = 2.0,
        quiet: float = 1.0,
        timeout: float = 15.0,
        until_answered: bool = False,
    ) -> bool:
        """Wait for a just-launched CLI to finish its startup render.

        Before the CLI puts the TTY in raw mode the kernel echoes input itself,
        which would fool send()'s echo check, so the first delivery waits until
        startup output has gone quiet. A startup dialog also goes quiet while it
        waits for a choice, so this keeps waiting until someone answers it: for
        at most dialog_timeout seconds, or with until_answered for as long as
        the CLI runs.

        Returns False if a startup dialog is still waiting for an answer.
        """
        loop = asyncio.get_running_loop()
        self._booting = True
        await asyncio.sleep(min_wait)
        deadline = None if until_answered else loop.time() + self.dialog_timeout
        while True:
            await self.wait_until_quiet(quiet, timeout)
            if not self.startup_prompt or not self.is_alive():
                break
            if deadline is not None and loop.time() >= deadline:
                return False
            await asyncio.sleep(quiet)
        self._booting = False
        self._output_tail = ""
        return True

    async def wait_until_quiet(self, quiet: float, timeout: float) -> None:
        """Return once no output has arrived for `quiet` seconds, or after `timeout`."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        last = self._output_seq
        while loop.time() < deadline:
            await asyncio.sleep(min(quiet, max(0.0, deadline - loop.time())))
            current = self._output_seq
            if current == last:
                return
            last = current

    @staticmethod
    async def _wait_writable(loop: asyncio.AbstractEventLoop, fd: int) -> None:
        future: asyncio.Future = loop.create_future()

        def on_writable():
            if not future.done():
                future.set_result(None)

        loop.add_writer(fd, on_writable)
        try:
            await future
        finally:
            loop.remove_writer(fd)

    def resize(self, cols: int, rows: int) -> None:
        self._cols = cols
        self._rows = rows
        if self.master_fd is not None:
            self._set_size(self.master_fd, rows, cols)

    def wait(self) -> None:
        if self._proc is not None:
            self._proc.wait()

    def _process_groups(self) -> set[int]:
        """Every process group started from this terminal.

        The shell runs in its own session (setsid), but with job control each
        command it launches (the claude/codex CLI, background jobs) gets its own
        process group, so killing only the shell's group would orphan them.
        """
        groups = {self._proc.pid} | _descendant_process_groups(self._proc.pid)
        if self.master_fd is not None:
            try:
                groups.add(os.tcgetpgrp(self.master_fd))
            except OSError:
                pass
        return groups - {0, 1, os.getpgrp()}

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    @property
    def pid(self) -> int:
        if self._proc is None:
            raise RuntimeError("PTY not started")
        return self._proc.pid

    @staticmethod
    def _set_size(fd: int, rows: int, cols: int) -> None:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
