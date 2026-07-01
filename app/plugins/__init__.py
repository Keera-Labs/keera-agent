"""Plugin framework for keera-agent.

WordPress-style plugin system: plugins live in the top-level ``plugins/``
directory, are auto-discovered at boot, and register their routes and MCP
tools only while activated.
"""

from app.plugins.base import Plugin
from app.plugins.registry import PluginRegistry

__all__ = ["Plugin", "PluginRegistry"]
