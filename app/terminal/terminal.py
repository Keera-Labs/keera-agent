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
        self._shell = shell or os.environ.get('SHELL', '/bin/bash')
        self._cwd = cwd or os.path.expanduser('~')
        self._cols = cols
        self._rows = rows
        self._env = _with_color_env(env or os.environ.copy())
        self._proc: subprocess.Popen | None = None
        self.master_fd: int | None = None

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
        os.write(self.master_fd, data)

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
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
