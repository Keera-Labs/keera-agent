"""Desktop shell."""
import os
import pathlib
import shutil
import socket
import sys
import threading
import time
from urllib.parse import urlparse

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
BUNDLED = getattr(sys, "frozen", False)
BASE_DIR = pathlib.Path(getattr(sys, "_MEIPASS", PROJECT_ROOT)) if BUNDLED else PROJECT_ROOT
DATA_DIR = pathlib.Path(
    os.environ.get("KEERA_DATA_DIR")
    or pathlib.Path.home() / "Library" / "Application Support" / "Keera Agent"
)


def _configure_environment() -> None:
    """Populate env vars and cwd that the framework reads at import time.

    Must run before `bootstrap.application` is imported: the framework builds
    its Config from the environment on import, so any DB/storage/log path set
    afterwards (previously inside main()) was ignored, crashing the desktop boot.
    """
    os.environ["APP_ENV"] = "desktop"
    os.chdir(BASE_DIR)

    storage = DATA_DIR / "storage"
    (storage / "logs").mkdir(parents=True, exist_ok=True)
    (storage / "app" / "public").mkdir(parents=True, exist_ok=True)

    db = DATA_DIR / "keera.db"
    perms = storage / "default_permissions.json"
    if not perms.exists():
        seed = BASE_DIR / "storage" / "default_permissions.json"
        if seed.exists():
            shutil.copyfile(seed, perms)

    os.environ["DB_DATABASE"] = str(db)
    os.environ["DB_URL"] = f"sqlite+aiosqlite:///{db}"
    os.environ["FILESYSTEM_DISK_ROOT"] = str(storage)
    os.environ["FILESYSTEM_PUBLIC_DISK_ROOT"] = str(storage / "app" / "public")
    os.environ["LOG_DAILY_PATH"] = str(storage / "logs")
    os.environ["KEERA_DEFAULT_PERMS_PATH"] = str(perms)


_configure_environment()

from bootstrap.application import app  # noqa: E402
from fastapi_startkit import Config  # noqa: E402

url = urlparse(Config.get('fastapi').get('app_url'))
HOST = url.hostname or "127.0.0.1"
PORT = url.port or 4545
WINDOW_TITLE = "Keera Agent"
STARTUP_TIMEOUT = 30.0


def _migrate() -> None:
    from cleo.io.inputs.string_input import StringInput
    from fastapi_startkit.console import ConsoleApplication

    console = ConsoleApplication(app)
    console.auto_exits(False)
    console.run(StringInput("db:migrate"))


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


def _serve() -> None:
    from cleo.io.inputs.string_input import StringInput
    from fastapi_startkit.console import ConsoleApplication

    console = ConsoleApplication(app)
    console.auto_exits(False)
    console.run(StringInput(f"serve"))


def _boot_server() -> None:
    if _is_listening(HOST, PORT):
        print(f"reusing server already listening on {HOST}:{PORT}")
        return

    threading.Thread(target=_serve, name="serve", daemon=True).start()
    if not _wait_until_listening(HOST, PORT, STARTUP_TIMEOUT):
        raise RuntimeError(f"server did not start on {HOST}:{PORT} within {STARTUP_TIMEOUT}s")


def main() -> None:
    import webview

    _migrate()
    _boot_server()

    webview.create_window(WINDOW_TITLE, f"http://{HOST}:{PORT}", width=1280, height=860)
    webview.start()


if __name__ == "__main__":
    main()
