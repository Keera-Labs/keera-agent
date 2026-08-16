from fastapi_startkit.support import Provider

from app.plugins.registry import PluginRegistry


class PluginProvider(Provider):
    provider_key = "plugins"

    def register(self) -> None:
        self.app.bind("plugins", PluginRegistry())

    def boot(self) -> None:
        from app.plugins.loader import discover, sync_active

        registry: PluginRegistry = self.app.make("plugins")
        registry.bind_app(self.app.fastapi)

        for plugin in discover(self.app.base_path / "plugins"):
            registry.register(plugin)

        async def on_startup():
            await sync_active(registry)

        self.app.fastapi.add_event_handler("startup", on_startup)
