"""py2app build for the desktop POC.

Alias build (references the source tree, for local testing on this machine):
    uv run python setup.py py2app -A

Standalone build (self-contained .app):
    uv run python setup.py py2app
"""

from setuptools import setup
from setuptools.dist import Distribution


class Py2appDistribution(Distribution):
    def parse_config_files(self, *args, **kwargs):
        super().parse_config_files(*args, **kwargs)
        self.install_requires = []


APP = ["desktop.py"]

DATA_FILES = [
    ".env",
    "artisan",
    "templates",
    "public",
    "config",
    "routes",
    "bootstrap",
    "app",
    "providers",
    "databases",
    "storage",
]

OPTIONS = {
    "argv_emulation": False,
    "packages": [
        "fastapi_startkit",
        "bootstrap",
        "app",
        "config",
        "routes",
        "providers",
        "databases",
        "uvicorn",
        "webview",
        "fastapi",
        "starlette",
        "aiosqlite",
    ],
    "plist": {
        "CFBundleName": "Keera Agent",
        "CFBundleDisplayName": "Keera Agent",
        "CFBundleIdentifier": "com.keera.agent",
        "LSUIElement": False,
    },
}

setup(
    name="Keera Agent",
    app=APP,
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    distclass=Py2appDistribution,
)
