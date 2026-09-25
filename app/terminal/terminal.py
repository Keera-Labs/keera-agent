import asyncio
import fcntl
import os
import pty as _pty
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
        self._write_lock: asyncio.Lock | None = None
        self._send_lock: asyncio.Lock | None = None
        self._output_seq = 0

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
        lock = getattr(self, "_write_lock", None)
        if lock is None:
            lock = self._write_lock = asyncio.Lock()
        async with lock:
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

    def mark_output(self) -> None:
        """Record that the PTY produced output; the reader bridge calls this per chunk."""
        self._output_seq = getattr(self, "_output_seq", 0) + 1

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
        lock = getattr(self, "_send_lock", None)
        if lock is None:
            lock = self._send_lock = asyncio.Lock()
        async with lock:
            if body:
                seen = getattr(self, "_output_seq", 0)
                await self.write(PASTE_START + body + PASTE_END)
                await self._wait_for_echo(seen)
            await self.write(b"\r")

    async def _wait_for_echo(self, seen: int) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.echo_timeout
        while getattr(self, "_output_seq", 0) == seen and loop.time() < deadline:
            await asyncio.sleep(0.02)
        await self.wait_until_quiet(self.echo_settle, max(0.0, deadline - loop.time()))

    async def wait_for_cli_ready(
        self, min_wait: float = 2.0, quiet: float = 1.0, timeout: float = 15.0
    ) -> None:
        """Wait for a just-launched CLI to finish its startup render.

        Before the CLI puts the TTY in raw mode the kernel echoes input itself,
        which would fool send()'s echo check, so the first delivery waits until
        startup output has gone quiet.
        """
        await asyncio.sleep(min_wait)
        await self.wait_until_quiet(quiet, timeout)

    async def wait_until_quiet(self, quiet: float, timeout: float) -> None:
        """Return once no output has arrived for `quiet` seconds, or after `timeout`."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        last = getattr(self, "_output_seq", 0)
        while loop.time() < deadline:
            await asyncio.sleep(min(quiet, max(0.0, deadline - loop.time())))
            current = getattr(self, "_output_seq", 0)
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
