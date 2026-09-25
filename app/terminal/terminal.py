import asyncio
import fcntl
import os
import pty as _pty
import re
import struct
import subprocess
import termios


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
# nothing is submitted while one is on screen.
STARTUP_PROMPTS = re.compile(
    r"Quick safety check|Yes, I trust this folder|Yes, I accept"
    r"|Trust this folder\?|Skip until next version"
)
_ESCAPES = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b.")
# Plain text kept from the previous chunk so a phrase split across reads still matches.
_TAIL_CHARS = 200


def _plain_text(data: bytes) -> str:
    # Escapes become spaces: TUIs often move the cursor instead of printing blanks.
    text = _ESCAPES.sub(b" ", data).decode("utf-8", errors="replace")
    return re.sub(r"\s+", " ", text)


class Terminal:
    # send() waits at most echo_timeout for the CLI to echo a paste, and treats
    # echo_settle seconds of silence as the echo having finished rendering.
    echo_timeout = 3.0
    echo_settle = 0.3

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
        # The startup dialog currently on screen, if any. Cleared by user input,
        # which is the only thing that dismisses one.
        self.startup_prompt: str | None = None

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
        if self._proc:
            try:
                self._proc.kill()
                self._proc.wait()
            except OSError:
                pass
            self._proc = None
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

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
        plain = _plain_text(data)
        if self._output_tail.endswith(" "):
            plain = plain.lstrip(" ")
        text = self._output_tail + plain
        matches = [m for m in STARTUP_PROMPTS.finditer(text) if m.end() > len(self._output_tail)]
        if matches:
            self.startup_prompt = matches[-1].group(0)
        self._output_tail = text[-_TAIL_CHARS:]

    def mark_input(self) -> None:
        """Record that the user typed into the terminal, e.g. to answer a startup dialog."""
        self.startup_prompt = None

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
        self, min_wait: float = 2.0, quiet: float = 1.0, timeout: float = 15.0
    ) -> None:
        """Wait for a just-launched CLI to finish its startup render.

        Before the CLI puts the TTY in raw mode the kernel echoes input itself,
        which would fool send()'s echo check, so the first delivery waits until
        startup output has gone quiet. A startup dialog also goes quiet while it
        waits for a choice, so this keeps waiting until someone answers it.
        """
        self._booting = True
        await asyncio.sleep(min_wait)
        while True:
            await self.wait_until_quiet(quiet, timeout)
            if not self.startup_prompt or not self.is_alive():
                break
            await asyncio.sleep(quiet)
        self._booting = False
        self._output_tail = ""

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
