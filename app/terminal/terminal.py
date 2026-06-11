import asyncio
import fcntl
import os
import pty as _pty
import struct
import subprocess
import termios


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
        self._env = env or os.environ.copy()
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

    def write(self, data: bytes) -> None:
        if self.master_fd is None or not data:
            return
        os.write(self.master_fd, data)

    async def write_raw(self, data: bytes) -> None:
        if self.master_fd is None or not data:
            return
        if len(data) <= 1:
            os.write(self.master_fd, data)
            return
        for byte in data:
            os.write(self.master_fd, bytes([byte]))
            await asyncio.sleep(0.002)

    async def write_input(self, data: bytes) -> None:
        """Write a complete message atomically: strips trailing CR/LF, appends \\r,
        then writes the entire payload in a single os.write call.

        Unlike write_raw (which writes byte-by-byte with asyncio.sleep delays),
        this is guaranteed to be atomic within a single asyncio task — no other
        coroutine can interleave bytes between the characters of this message.
        That prevents spaces and other characters from being dropped when multiple
        coroutines write to the same PTY concurrently (e.g. agent relay messages
        arriving while other I/O is in flight).
        """
        data = data.rstrip(b'\r\n') + b'\r'
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
