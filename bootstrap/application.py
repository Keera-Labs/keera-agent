from pathlib import Path

from fastapi_startkit import Application
from fastapi_startkit.fastapi import FastAPIProvider
from fastapi_startkit.inertia import InertiaProvider
from fastapi_startkit.logging import LogProvider
from fastapi_startkit.masoniteorm import DatabaseProvider
from fastapi_startkit.storage import StorageProvider
from fastapi_startkit.vite import ViteProvider

from config.database import DatabaseConfig
from config.fastapi import FastAPIConfig
from config.storage import StorageConfig
from config.vite import ViteConfig
from providers.app_provider import AppProvider

app = Application(
    base_path=Path(__file__).parent.parent,
    providers=[
        LogProvider,
        (DatabaseProvider, DatabaseConfig),
        (FastAPIProvider, FastAPIConfig),
        (StorageProvider, StorageConfig),
        AppProvider,
        (ViteProvider, ViteConfig),
        InertiaProvider,
    ],
)
