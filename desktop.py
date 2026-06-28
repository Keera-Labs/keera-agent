"""Desktop shell (proof of concept)."""

import os
import pathlib
import socket
import subprocess
import sys
import threading
import time

from fastapi_startkit.environment import env

HOST = env("APP_HOST", "127.0.0.1")
PORT = int(env("APP_PORT", 4545))
WINDOW_TITLE = "Keera Agent"
STARTUP_TIMEOUT = 30.0

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
SERVER_CMD = ["uv", "run", "python", "artisan", "serve"]
BUNDLED = getattr(sys, "frozen", False)


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


def _boot_inprocess():
    import uvicorn

    config = uvicorn.Config(
        app="bootstrap.application:app",
        factory=True,
        host=HOST,
        port=PORT,
        reload=False,
        ws="websockets-sansio",
    )
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, name="uvicorn", daemon=True).start()
    return server


def _boot_server():
    if _is_listening(HOST, PORT):
        print(f"reusing server already listening on {HOST}:{PORT}")
        return None

    handle = _boot_inprocess() if BUNDLED else subprocess.Popen(SERVER_CMD, cwd=PROJECT_ROOT)
    if not _wait_until_listening(HOST, PORT, STARTUP_TIMEOUT):
        _stop_server(handle)
        raise RuntimeError(f"server did not start on {HOST}:{PORT} within {STARTUP_TIMEOUT}s")
    return handle


def _stop_server(handle) -> None:
    if handle is None:
        return
    if isinstance(handle, subprocess.Popen):
        handle.terminate()
        try:
            handle.wait(timeout=5)
        except subprocess.TimeoutExpired:
            handle.kill()
    else:
        handle.should_exit = True


def main() -> None:
    import webview

    os.chdir(PROJECT_ROOT)
    handle = _boot_server()

    webview.create_window(WINDOW_TITLE, f"http://{HOST}:{PORT}", width=1280, height=860)
    webview.start()

    _stop_server(handle)


if __name__ == "__main__":
    main()
