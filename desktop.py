"""Desktop shell (proof of concept).

Boots the existing FastAPI/Inertia app with uvicorn in a background thread and
renders it inside a native pywebview window. The web stack is untouched — this
is only a thin native wrapper around the same server `artisan serve` runs.

Run:
    uv sync --extra desktop
    uv run python desktop.py
"""

import socket
import threading
import time

import uvicorn

from fastapi_startkit.environment import env

HOST = env("APP_HOST", "127.0.0.1")
PORT = int(env("APP_PORT", 4545))
WINDOW_TITLE = "Keera Agent"
STARTUP_TIMEOUT = 30.0


def _build_server() -> uvicorn.Server:
    config = uvicorn.Config(
        app="bootstrap.application:app",
        factory=True,
        host=HOST,
        port=PORT,
        reload=False,
        ws="websockets-sansio",
        log_level="info",
    )
    return uvicorn.Server(config)


def _wait_until_listening(host: str, port: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.2)
    return False


def main() -> None:
    import webview

    server = _build_server()
    thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    thread.start()

    if not _wait_until_listening(HOST, PORT, STARTUP_TIMEOUT):
        raise RuntimeError(f"server did not start on {HOST}:{PORT} within {STARTUP_TIMEOUT}s")

    webview.create_window(WINDOW_TITLE, f"http://{HOST}:{PORT}", width=1280, height=860)
    webview.start()

    # pywebview.start() blocks until the window closes; stop the server on exit.
    server.should_exit = True
    thread.join(timeout=5.0)


if __name__ == "__main__":
    main()
