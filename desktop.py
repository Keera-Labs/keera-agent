"""Desktop shell (proof of concept).

Renders the existing FastAPI/Inertia app inside a native pywebview window. It
does NOT manage a server — the app is expected to already be serving on
APP_HOST:APP_PORT (started separately, or bundled alongside this window). This
keeps the wrapper a thin native shell over the same server `artisan serve` runs.

Run:
    uv sync
    uv run python artisan serve      # (or `npm run dev`) — start the app
    uv run python desktop.py         # open the native window
"""

import socket
import sys
import time

from fastapi_startkit.environment import env

HOST = env("APP_HOST", "127.0.0.1")
PORT = int(env("APP_PORT", 4545))
WINDOW_TITLE = "Keera Agent"
# Tolerate a server that is still coming up (e.g. started concurrently by a
# bundle); we wait for it, we never start it.
READY_TIMEOUT = 15.0


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


def main() -> None:
    import webview

    if not _wait_until_listening(HOST, PORT, READY_TIMEOUT):
        sys.exit(
            f"No server is listening on {HOST}:{PORT}. "
            f"Start it first (e.g. `uv run python artisan serve`), then run desktop.py."
        )

    webview.create_window(WINDOW_TITLE, f"http://{HOST}:{PORT}", width=1280, height=860)
    webview.start()


if __name__ == "__main__":
    main()
