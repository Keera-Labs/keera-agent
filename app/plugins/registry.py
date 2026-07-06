"""In-memory registry of discovered plugins and their live active state.

The registry is the single source of truth the running app consults: the MCP
server reads :meth:`active_tool_classes` on every ``tools/list`` call, and
:meth:`activate` / :meth:`deactivate` mount and unmount plugin routers on the
live FastAPI app so toggling a plugin takes effect without a restart.
"""

from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi_startkit.mcp import Tool

    from app.plugins.base import Plugin


class PluginRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, "Plugin"] = {}
        self._active: set[str] = set()
        self._fastapi: Optional["FastAPI"] = None
        # slug -> the route objects mounting produced, so we can unmount them.
        self._routes: dict[str, list] = {}

    def bind_app(self, fastapi: "FastAPI") -> None:
        self._fastapi = fastapi

    # ── discovery ──────────────────────────────────────────────────────────
    def register(self, plugin: "Plugin") -> None:
        self._plugins[plugin.slug] = plugin

    def all(self) -> "list[Plugin]":
        return list(self._plugins.values())

    def get(self, slug: str) -> "Optional[Plugin]":
        return self._plugins.get(slug)

    def is_active(self, slug: str) -> bool:
        return slug in self._active

    # ── activation ─────────────────────────────────────────────────────────
    # activate/deactivate mutate fastapi.router.routes in place at runtime.
    # This is safe for a single-user desktop app but is not concurrency-guarded.
    def activate(self, slug: str) -> None:
        plugin = self._plugins.get(slug)
        if plugin is None or slug in self._active:
            return
        if self._fastapi is not None:
            routes = self._fastapi.router.routes
            before = set(id(r) for r in routes)
            for router in plugin.routers():
                self._fastapi.include_router(router)
            added = [r for r in routes if id(r) not in before]
            # Move the new routes to the front so they resolve ahead of the
            # SPA/static catch-all mount that would otherwise swallow them.
            for route in added:
                routes.remove(route)
            for route in reversed(added):
                routes.insert(0, route)
            self._routes[slug] = added
            self._fastapi.openapi_schema = None
        self._active.add(slug)

    def deactivate(self, slug: str) -> None:
        if slug not in self._active:
            return
        if self._fastapi is not None:
            for route in self._routes.pop(slug, []):
                try:
                    self._fastapi.router.routes.remove(route)
                except ValueError:
                    pass
            self._fastapi.openapi_schema = None
        self._active.discard(slug)

    # ── MCP ────────────────────────────────────────────────────────────────
    def active_tool_classes(self) -> "list[type[Tool]]":
        tools: list = []
        for slug, plugin in self._plugins.items():
            if slug in self._active:
                tools.extend(plugin.tools())
        return tools
