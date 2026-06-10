import asyncio
import json
import subprocess
from dataclasses import dataclass


@dataclass
class ProcessResult:
    _stdout: str
    _stderr: str
    _exit_code: int

    def output(self) -> str:
        return self._stdout

    def error(self) -> str:
        return self._stderr

    def exit_code(self) -> int:
        return self._exit_code

    def successful(self) -> bool:
        return self._exit_code == 0

    def output_json(self):
        return json.loads(self._stdout)


class Process:
    @staticmethod
    def run(cmd: str, cwd: str | None = None, timeout: int | None = None) -> ProcessResult:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return ProcessResult(
            _stdout=result.stdout,
            _stderr=result.stderr,
            _exit_code=result.returncode,
        )

    @staticmethod
    async def run_async(cmd: str, cwd: str | None = None, timeout: int | None = None) -> ProcessResult:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise
        return ProcessResult(
            _stdout=stdout.decode(),
            _stderr=stderr.decode(),
            _exit_code=proc.returncode,
        )
