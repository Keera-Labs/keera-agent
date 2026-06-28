"""Desktop shell (proof of concept).

Single entry point for the standalone native app: it boots the existing
FastAPI/Inertia framework by spawning the project's own serve command
(`uv run python artisan serve`) and renders the app inside a native pywebview
window. Closing the window stops the server. The web stack itself is untouched.

If a server is already listening on APP_HOST:APP_PORT (e.g. `npm run dev`), it
is reused instead of spawning a second one.

Run:
    uv sync
    uv run python desktop.py
"""

import os
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
# The command that boots the framework. Single place to swap when packaging a
# true standalone bundle (where `uv`/`artisan` are replaced by the bundled
# server executable).
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
    """Spawn the framework's serve command, unless a server is already
    listening (then reuse it). Returns the process we started so it can be
    stopped on exit, or None if an existing server was reused."""
    if _is_listening(HOST, PORT):
        print(f"reusing server already listening on {HOST}:{PORT}")
        return None

    # Force reload off so the server is a single process we can stop cleanly
    # (uvicorn's reloader would spawn its own child tree).
    server_env = {**os.environ, "APP_RELOAD": "false"}
    proc = subprocess.Popen(SERVER_CMD, cwd=PROJECT_ROOT, env=server_env)

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

    # pywebview.start() blocks until the window closes. Only stop the server if
    # we spawned it; a reused, externally-managed one is left running.
    if proc is not None:
        _stop_server(proc)


if __name__ == "__main__":
    main()
