"""Jira plugin service provider — the entry point the loader discovers."""

from app.plugins.base import Plugin
from plugins.jira.routes import build_router
from plugins.jira.tools import JIRA_TOOLS


class JiraPlugin(Plugin):
    slug = "jira"
    name = "Jira"
    description = "Search, update and log work on Jira issues from keera-agent."
    version = "0.1.0"

    def routers(self):
        return [build_router()]

    def tools(self):
        return JIRA_TOOLS
