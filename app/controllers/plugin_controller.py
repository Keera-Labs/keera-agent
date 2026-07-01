"""Core API for the plugin system: list discovered plugins and toggle them."""

import logging

from fastapi.responses import JSONResponse
from fastapi_startkit.application import app

from app.models.Plugin import Plugin as PluginModel
from app.plugins.registry import PluginRegistry

logger = logging.getLogger("keera.plugins")


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


async def uninstall(slug: str):
    registry = _registry()
    plugin = registry.get(slug)
    if plugin is None:
        return JSONResponse({"error": f"plugin '{slug}' not found"}, status_code=404)

    # Run the plugin's own hooks first so a failure cannot leave it half
    # removed: routes stay mounted and the row keeps active=True until both
    # hooks succeed. An active plugin gets its normal teardown hook before
    # uninstall() so uninstall() always runs on a stopped plugin.
    was_active = registry.is_active(slug)
    try:
        if was_active:
            await plugin.deactivate()
        await plugin.uninstall()
    except Exception:
        logger.exception("Plugin '%s' uninstall failed", slug)
        return JSONResponse(
            {"error": f"plugin '{slug}' uninstall failed"}, status_code=500
        )

    if was_active:
        registry.deactivate(slug)
    await PluginModel.where("slug", slug).delete()

    return JSONResponse({"data": _present(plugin, False)})


async def _set_active(slug: str, active: bool):
    registry = _registry()
    plugin = registry.get(slug)
    if plugin is None:
        return JSONResponse({"error": f"plugin '{slug}' not found"}, status_code=404)

    row = await PluginModel.where("slug", slug).first()
    currently_active = bool(row.active) if row is not None else False

    # Lifecycle hooks fire only on a real transition. Re-issuing the current
    # state is a true no-op: no hook, no write.
    if currently_active == active:
        return JSONResponse({"data": _present(plugin, active)})

    # Run the plugin's own hook first so a failure cannot leave it half-toggled:
    # nothing is mounted/unmounted or persisted unless the hook succeeds.
    try:
        if active:
            await plugin.activate()
        else:
            await plugin.deactivate()
    except Exception:
        action = "activation" if active else "deactivation"
        logger.exception("Plugin '%s' %s hook failed", slug, action)
        return JSONResponse(
            {"error": f"plugin '{slug}' {action} failed"}, status_code=500
        )

    if active:
        registry.activate(slug)
    else:
        registry.deactivate(slug)

    if row is None:
        await PluginModel.create({
            "slug": plugin.slug,
            "name": plugin.name,
            "description": plugin.description,
            "path": plugin.path,
            "active": active,
        })
    else:
        await row.update({"active": active})

    return JSONResponse({"data": _present(plugin, active)})
