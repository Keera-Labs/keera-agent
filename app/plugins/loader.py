"""Convention-based plugin discovery and activation sync.

Discovery is filesystem-only (safe to run synchronously at boot): every
immediate subfolder of ``plugins/`` that exposes a ``provider.py`` defining a
:class:`~app.plugins.base.Plugin` subclass is a plugin. Persisting discovered
plugins and honouring their stored active flag needs the database, so it runs
in an async startup hook via :func:`sync_active`.
"""

import importlib
import logging
from pathlib import Path

from app.plugins.base import Plugin
from app.plugins.registry import PluginRegistry

logger = logging.getLogger("keera.plugins")


def discover(plugins_dir: Path) -> list[Plugin]:
    """Return one Plugin instance per discovered plugin folder."""
    found: list[Plugin] = []
    if not plugins_dir.is_dir():
        return found

    for entry in sorted(plugins_dir.iterdir()):
        if not entry.is_dir() or entry.name.startswith((".", "_")):
            continue
        if not (entry / "provider.py").exists():
            continue

        module_name = f"{plugins_dir.name}.{entry.name}.provider"
        try:
            module = importlib.import_module(module_name)
        except Exception:
            logger.exception("Failed to import plugin provider '%s'", module_name)
            continue

        plugin_cls = _find_plugin_class(module)
        if plugin_cls is None:
            logger.warning("No Plugin subclass found in '%s'", module_name)
            continue

        plugin = plugin_cls()
        if not plugin.slug:
            logger.warning("Plugin in '%s' has no slug; skipping", module_name)
            continue
        plugin.path = str(entry)
        found.append(plugin)

    return found


def _find_plugin_class(module) -> type[Plugin] | None:
    for obj in vars(module).values():
        if isinstance(obj, type) and issubclass(obj, Plugin) and obj is not Plugin:
            return obj
    return None


async def sync_active(registry: PluginRegistry) -> None:
    """Upsert a row per discovered plugin and activate those flagged active."""
    from app.models.Plugin import Plugin as PluginModel

    rows = {row.slug: row for row in await PluginModel.all()}

    for plugin in registry.all():
        row = rows.get(plugin.slug)
        if row is None:
            await PluginModel.create(
                {
                    "slug": plugin.slug,
                    "name": plugin.name,
                    "description": plugin.description,
                    "path": plugin.path,
                    "active": False,
                }
            )
            continue

        await row.update(
            {
                "name": plugin.name,
                "description": plugin.description,
                "path": plugin.path,
            }
        )
        if row.active:
            registry.activate(plugin.slug)
