"""Keera MCP server — KeeraServer and its resources."""

import json
import os

from fastapi_startkit.mcp import Server, Resource

from app.mcp.tools import KEERA_TOOLS
from app.mcp.browser_tools import BROWSER_TOOLS


class ActiveTasksResource(Resource):
    uri = "keera://tasks/active"
    name = "active_tasks"
    description = "Pending and in-progress tasks for this project. Read this at the start of every session."
    mime_type = "text/plain"

    async def read(self, **kwargs) -> str:
        from app.models.Project import Project
        from app.models.Task import Task

        project_path = kwargs.get("project_path")
        project = None
        if project_path:
            expanded = os.path.expanduser(project_path).rstrip("/")
            projects = await Project.all()
            for p in projects:
                if os.path.expanduser(p.path).rstrip("/") == expanded:
                    project = p
                    break

        if not project:
            return "No project found. Set the X-Project-Path header to your project directory."

        tasks = await (
            Task.where("project_id", project.id)
                .where_in("status", ["pending", "in_progress"])
                .order_by("id", "asc")
                .get()
        )

        if not tasks:
            return f"No pending or in-progress tasks for project '{project.name}'."

        def _load(v):
            try:
                return json.loads(v) if v else []
            except (ValueError, TypeError):
                return []

        lines = [f"Active tasks for '{project.name}':", ""]
        for t in tasks:
            status_label = "[ ]" if t.status == "pending" else "[→]"
            lines.append(f"{status_label} #{t.id} {t.title or t.body}  ({t.priority or 'medium'})")
            for c in _load(t.acceptance_criteria):
                lines.append(f"     • {c}")
        return "\n".join(lines)


class KeeraServer(Server):
    name = "keera-agent"
    description = "Keera project management MCP server."
    instructions = "Call tools/list to see available tools. Use list_tasks or the keera://tasks/active resource to see current work."

    def tools(self):
        return KEERA_TOOLS + BROWSER_TOOLS

    def resources(self):
        return [ActiveTasksResource]
