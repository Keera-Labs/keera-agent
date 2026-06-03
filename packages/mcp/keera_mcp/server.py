"""
Keera MCP Server

Thin FastMCP wrapper around the tool handlers already implemented in
app/mcp/tools.py.  The ORM is initialised the same way DatabaseProvider
does it so all existing models work without any duplication.

Run from the project root:
  uv run python -m keera_mcp
  mcp run packages/mcp/keera_mcp/server.py

Environment variables:
  KEERA_PROJECT_PATH — project directory to scope keera://tasks/active
                       (omit to show tasks across all projects)
"""

import os
import sys
from pathlib import Path

# Ensure the project root (keera-agent/) is on sys.path so app.* imports work.
# __file__ = packages/mcp/keera_mcp/server.py → root is three levels up.
_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

# Remove CWD entries that would let packages/mcp/mcp.py shadow the installed
# mcp SDK (Python prepends '' when running with -m).
sys.path = [p for p in sys.path if p not in ("", ".")]

# ── ORM bootstrap ─────────────────────────────────────────────────────────────
# Mirrors what DatabaseProvider.register() does, without booting the full app.

from fastapi_startkit.masoniteorm.connections.factory import ConnectionFactory  # noqa: E402
from fastapi_startkit.masoniteorm.connections.manager import DatabaseManager    # noqa: E402
from fastapi_startkit.masoniteorm import Model                                  # noqa: E402
from config.database import DatabaseConfig                                       # noqa: E402

_db_config = DatabaseConfig()
_db_manager = DatabaseManager(ConnectionFactory(), _db_config)
Model.db_manager = _db_manager

# ── existing handlers ─────────────────────────────────────────────────────────

from app.mcp.tools import HANDLERS           # noqa: E402
from app.mcp.controller import _fetch_active_tasks  # noqa: E402

# ── FastMCP server ────────────────────────────────────────────────────────────

from mcp.server.fastmcp import FastMCP       # noqa: E402

mcp = FastMCP(
    "keera-agent",
    instructions=(
        "Keera is a task management and multi-agent coordination system. "
        "Use create_task to plan work, list_tasks to see what needs doing, "
        "and send_message_to_agent / relay_to_agent to coordinate with other agents."
    ),
)

# ── tool registration ─────────────────────────────────────────────────────────
# Each @mcp.tool() function is a thin shim that forwards kwargs to the existing
# handler.  The docstring becomes the MCP tool description.

@mcp.tool()
async def create_task(
    project_path: str,
    title: str,
    description: str,
    acceptance_criteria: list[str],
    testing_methods: list[str],
    validation_steps: list[str],
    priority: str = "medium",
    assignees: list[str] | None = None,
) -> str:
    """
    Create a well-planned task in the current Keera project.
    Before calling this tool, think through the full implementation plan:
    what 'done' looks like (acceptance_criteria), how it will be tested
    (testing_methods), and what edge cases / QA steps are needed
    (validation_steps). All three are required.
    """
    return await HANDLERS["create_task"](locals())


@mcp.tool()
async def list_tasks(
    project_path: str,
    status: str | None = None,
) -> str:
    """List tasks for the current Keera project, optionally filtered by status.
    Status values: pending, in_progress, completed, cancelled."""
    return await HANDLERS["list_tasks"](locals())


@mcp.tool()
async def get_task(task_id: int) -> str:
    """Get full details of a single task by ID."""
    return await HANDLERS["get_task"](locals())


@mcp.tool()
async def update_task(
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    body: str | None = None,
    priority: str | None = None,
    assignees: list[str] | None = None,
    acceptance_criteria: list[str] | None = None,
    testing_methods: list[str] | None = None,
    validation_steps: list[str] | None = None,
) -> str:
    """Update any fields of a task (title, description, body, priority, assignees,
    acceptance_criteria, testing_methods, validation_steps)."""
    return await HANDLERS["update_task"](locals())


@mcp.tool()
async def update_task_status(task_id: int, status: str) -> str:
    """Change the status of a task.
    Status values: pending, in_progress, completed, cancelled."""
    return await HANDLERS["update_task_status"](locals())


@mcp.tool()
async def send_message_to_agent(
    sender_project_path: str,
    receiver_project_path: str,
    message: str,
) -> str:
    """Send a message from this agent to another agent in a different project.
    Delivered immediately if the target agent is active, otherwise queued."""
    return await HANDLERS["send_message_to_agent"](locals())


@mcp.tool()
async def get_agent_messages(
    project_path: str,
    unread_only: bool = False,
) -> str:
    """Get messages in the inbox for this agent (sent from other agents).
    Set unread_only=true to return only pending messages."""
    return await HANDLERS["get_agent_messages"](locals())


@mcp.tool()
async def list_agents(project_path: str) -> str:
    """List all agents registered in the current project."""
    return await HANDLERS["list_agents"](locals())


@mcp.tool()
async def spawn_agent(
    project_path: str,
    name: str,
    agent_type: str,
    system_prompt: str | None = None,
    message: str | None = None,
    model: str = "claude-sonnet-4-6",
    task_id: int | None = None,
) -> str:
    """Create a new agent in the current project and optionally start it.
    agent_type: pm, software_engineer, qa, or custom."""
    return await HANDLERS["spawn_agent"](locals())


@mcp.tool()
async def relay_to_agent(
    from_agent_id: int,
    to_agent_id: int,
    message: str,
) -> str:
    """Send a message to another agent in the same project.
    Delivered immediately if the agent is running, otherwise queued."""
    return await HANDLERS["relay_to_agent"](locals())


# ── resource ──────────────────────────────────────────────────────────────────

@mcp.resource("keera://tasks/active")
async def active_tasks() -> str:
    """Active Tasks — pending and in-progress tasks for this project.
    Set KEERA_PROJECT_PATH to scope to a specific project."""
    project_path = os.environ.get("KEERA_PROJECT_PATH", "").strip() or None
    return await _fetch_active_tasks(project_path)
