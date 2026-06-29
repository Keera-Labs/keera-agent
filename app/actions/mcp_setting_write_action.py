import json
import os

from fastapi_startkit import Config

from app.models.Project import Project
from app.utils.json_utils import atomic_write_json

# Key under mcpServers reserved for the keera-managed HTTP MCP entry in .mcp.json.
MCP_KEY = "keera-agent-mcp"


class McpSettingWriteAction:
    """Upsert the keera-agent-mcp server entry into a project's .mcp.json.

    The project directory is read from the database and the MCP URL is derived
    from the configured app_url, so the entry stays synced when the app URL
    changes. The keera-agent-mcp key is always replaced with a freshly computed
    HTTP entry; all other mcpServers entries are preserved.
    """

    def __init__(self, project_id):
        self.project_id = project_id

    @staticmethod
    def prepare(project_id):
        return McpSettingWriteAction(project_id=project_id)

    async def execute(self) -> bool:
        """Write/update the project's .mcp.json. Returns True if it changed."""
        project = await Project.find(self.project_id)
        if project is None:
            return False

        directory = os.path.expanduser(project.path)
        if not os.path.isdir(directory):
            return False

        mcp_path = os.path.join(directory, ".mcp.json")
        data = self._load(mcp_path)
        servers = data.setdefault("mcpServers", {})
        desired = self._desired_entry(directory)
        if servers.get(MCP_KEY) == desired:
            return False

        servers[MCP_KEY] = desired
        atomic_write_json(mcp_path, data)
        print(f"[keera] MCP config synced in {directory}/.mcp.json")
        return True

    @staticmethod
    def _desired_entry(directory: str) -> dict:
        base_url = Config.get("fastapi.app_url")
        return {
            "type": "http",
            "url": f"{base_url}/mcp",
            # X-Project-Path scopes the MCP server to the project root.
            "headers": {"X-Project-Path": directory},
        }

    @staticmethod
    def _load(mcp_path: str) -> dict:
        if os.path.exists(mcp_path):
            try:
                with open(mcp_path) as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                data = {}
            if isinstance(data, dict):
                return data
        return {}
