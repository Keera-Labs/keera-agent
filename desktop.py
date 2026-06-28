"""Desktop shell (proof of concept).

Boots the app via `uv run python artisan serve` and renders it in a native
pywebview window. Closing the window stops the server.

Run:
    uv sync
    uv run python desktop.py
"""

import pathlib
import socket
import subprocess
import time

from fastapi_startkit.environment import env

HOST = env("APP_HOST", "127.0.0.1")
PORT = int(env("APP_PORT", 4545))
WINDOW_TITLE = "Keera Agent"
STARTUP_TIMEOUT = 30.0

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
SERVER_CMD = ["uv", "run", "python", "artisan", "serve"]


def _is_listening(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def _wait_until_listening(host: str, port: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _is_listening(host, port):
            return True
        time.sleep(0.2)
    return False


def _boot_server() -> subprocess.Popen | None:
    if _is_listening(HOST, PORT):
        print(f"reusing server already listening on {HOST}:{PORT}")
        return None

    proc = subprocess.Popen(SERVER_CMD, cwd=PROJECT_ROOT)
    if not _wait_until_listening(HOST, PORT, STARTUP_TIMEOUT):
        proc.terminate()
        raise RuntimeError(f"server did not start on {HOST}:{PORT} within {STARTUP_TIMEOUT}s")
    return proc


def _stop_server(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def main() -> None:
    import webview

    proc = _boot_server()

    webview.create_window(WINDOW_TITLE, f"http://{HOST}:{PORT}", width=1280, height=860)
    webview.start()

    if proc is not None:
        _stop_server(proc)


if __name__ == "__main__":
    main()
