"""Desktop shell (proof of concept).

Renders the existing FastAPI/Inertia app inside a native pywebview window. If a
server is already listening on APP_HOST:APP_PORT (e.g. `npm run dev` or a built
dist), it is reused as-is; only when nothing is listening does this boot its own
uvicorn instance in a background thread. Either way the web stack is untouched —
this is just a thin native wrapper around the same server `artisan serve` runs.

Run:
    uv sync
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


def _ensure_server() -> uvicorn.Server | None:
    """Reuse an already-running server, else boot one. Returns the server we
    started (so the caller can stop it on exit), or None if we reused one."""
    if _is_listening(HOST, PORT):
        print(f"reusing server already listening on {HOST}:{PORT}")
        return None

    server = _build_server()
    threading.Thread(target=server.run, name="uvicorn", daemon=True).start()
    if not _wait_until_listening(HOST, PORT, STARTUP_TIMEOUT):
        raise RuntimeError(f"server did not start on {HOST}:{PORT} within {STARTUP_TIMEOUT}s")
    return server


def main() -> None:
    import webview

    server = _ensure_server()

    webview.create_window(WINDOW_TITLE, f"http://{HOST}:{PORT}", width=1280, height=860)
    webview.start()

    # pywebview.start() blocks until the window closes. Only stop the server if
    # we started it; a reused (externally-managed) server is left running.
    if server is not None:
        server.should_exit = True


if __name__ == "__main__":
    main()
