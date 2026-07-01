from pathlib import Path

from fastapi_startkit import Application
from fastapi_startkit.broadcasting import ReverbProvider
from fastapi_startkit.broadcasting.config import BroadcastingConfig
from fastapi_startkit.fastapi import FastAPIProvider
from fastapi_startkit.inertia import InertiaProvider
from fastapi_startkit.logging import LogProvider
from fastapi_startkit.masoniteorm import DatabaseProvider
from fastapi_startkit.mcp import McpProvider
from fastapi_startkit.skills import AISkillProvider
from fastapi_startkit.storage import StorageProvider
from fastapi_startkit.vite import ViteProvider

from config.database import DatabaseConfig
from config.fastapi import FastAPIConfig
from config.storage import StorageConfig
from config.vite import ViteConfig
from providers.app_provider import AppProvider
from providers.plugin_provider import PluginProvider
from providers.terminal_provider import TerminalProvider

app = Application(
    base_path=Path(__file__).parent.parent,
    providers=[
        LogProvider,
        (DatabaseProvider, DatabaseConfig),
        (FastAPIProvider, FastAPIConfig),
        McpProvider,
        AISkillProvider,
        (StorageProvider, StorageConfig),
        AppProvider,
        PluginProvider,
        TerminalProvider,
        (ViteProvider, ViteConfig),
        InertiaProvider,
        (ReverbProvider, BroadcastingConfig),
    ],
)
