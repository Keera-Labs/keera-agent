"""Core API for the plugin system: list discovered plugins and toggle them."""

from fastapi.responses import JSONResponse
from fastapi_startkit.application import app

from app.models.Plugin import Plugin as PluginModel
from app.plugins.registry import PluginRegistry


def _registry() -> PluginRegistry:
    return app().make("plugins")


def _present(plugin, active: bool) -> dict:
    return {
        "slug": plugin.slug,
        "name": plugin.name,
        "description": plugin.description,
        "version": getattr(plugin, "version", None),
        "path": plugin.path,
        "active": active,
    }


async def index():
    registry = _registry()
    data = [_present(p, registry.is_active(p.slug)) for p in registry.all()]
    return JSONResponse({"data": data})


async def activate(slug: str):
    return await _set_active(slug, True)


async def deactivate(slug: str):
    return await _set_active(slug, False)


async def _set_active(slug: str, active: bool):
    registry = _registry()
    plugin = registry.get(slug)
    if plugin is None:
        return JSONResponse({"error": f"plugin '{slug}' not found"}, status_code=404)

    row = await PluginModel.where("slug", slug).first()
    if row is None:
        row = await PluginModel.create({
            "slug": plugin.slug,
            "name": plugin.name,
            "description": plugin.description,
            "path": plugin.path,
            "active": active,
        })
    else:
        await row.update({"active": active})

    if active:
        registry.activate(slug)
    else:
        registry.deactivate(slug)

    return JSONResponse({"data": _present(plugin, active)})
