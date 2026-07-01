"""Base class every plugin's service provider subclasses.

A plugin folder under ``plugins/`` is recognised when its ``provider.py``
module defines a single subclass of :class:`Plugin`. The subclass declares the
plugin's identity and, optionally, the FastAPI routers and MCP tools it
contributes. Both are registered only while the plugin is active.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import APIRouter
    from fastapi_startkit.mcp import Tool


class Plugin:
    slug: str = ""
    name: str = ""
    description: str = ""
    version: str = "0.1.0"

    # Filesystem path of the plugin folder, set by the loader on discovery.
    path: str = ""

    def routers(self) -> "list[APIRouter]":
        """FastAPI routers to mount while this plugin is active."""
        return []

    def tools(self) -> "list[type[Tool]]":
        """MCP tool classes to expose while this plugin is active."""
        return []
