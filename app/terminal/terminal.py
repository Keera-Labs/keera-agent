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


class Terminal:
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

    async def send(self, message: str) -> None:
        text_bytes = message.encode().rstrip(b"\r\n")
        await self.write(text_bytes)
        await asyncio.sleep(0.05)
        await self.write(b"\r")

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
