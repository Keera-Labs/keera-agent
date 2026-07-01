"""Jira plugin service provider — the entry point the loader discovers."""

import logging

from app.plugins.base import Plugin
from plugins.jira.config import jira_config
from plugins.jira.routes import build_router
from plugins.jira.tools import JIRA_TOOLS

logger = logging.getLogger("keera.plugins")


class JiraPlugin(Plugin):
    slug = "jira"
    name = "Jira"
    description = "Search, update and log work on Jira issues from keera-agent."
    version = "0.1.0"

    def routers(self):
        return [build_router()]

    def tools(self):
        return JIRA_TOOLS

    async def activate(self) -> None:
        if not jira_config().is_configured:
            logger.warning(
                "Jira plugin activated but not configured; set JIRA_BASE_URL, "
                "JIRA_USERNAME and JIRA_TOKEN for its tools to work."
            )

    async def deactivate(self) -> None:
        logger.info("Jira plugin deactivated.")

    async def uninstall(self) -> None:
        logger.info("Jira plugin uninstalled.")
