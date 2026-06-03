"""
Keera MCP Server

Exposes Keera's task management and agent coordination tools via the
Model Context Protocol using the official mcp Python SDK (FastMCP).

Environment variables:
  KEERA_DB           — path to keera.db (default: storage/keera.db in CWD)
  KEERA_PROJECT_PATH — project directory to scope the keera://tasks/active
                       resource (optional; omit to show tasks for all projects)

Start:
  uv run python -m keera_mcp        # stdio transport (Claude Desktop / MCP clients)
  mcp run keera_mcp/server.py       # via the mcp CLI
"""

import json
import os
import sys
from datetime import datetime, timezone

# Guard against packages/mcp/mcp.py shadowing the installed mcp package.
# This matters when Python is invoked with CWD = packages/mcp/ and '' is
# prepended to sys.path.  __main__.py already strips CWD, but server.py may
# also be loaded directly (e.g. via `mcp run`), so we do it here too.
sys.path = [p for p in sys.path if p not in ("", ".")]

import aiosqlite
from mcp.server.fastmcp import FastMCP

from keera_mcp.db import get_db_path, get_project_by_path, load_json_field

# ── server instance ───────────────────────────────────────────────────────────

mcp = FastMCP(
    "keera-agent",
    instructions=(
        "Keera is a task management and multi-agent coordination system. "
        "Use create_task to plan work with clear acceptance criteria, "
        "list_tasks / get_task to inspect what needs doing, and "
        "send_message_to_agent / relay_to_agent to coordinate with other agents."
    ),
)

_DB_PATH = get_db_path()


# ── internal helpers ──────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize_task(row: aiosqlite.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"] or row["description"],
        "description": row["description"],
        "body": row["body"],
        "priority": row["priority"] or "medium",
        "status": row["status"],
        "assignees": load_json_field(row["assignees"]),
        "acceptance_criteria": load_json_field(row["acceptance_criteria"]),
        "testing_methods": load_json_field(row["testing_methods"]),
        "validation_steps": load_json_field(row["validation_steps"]),
        "created_at": row["created_at"],
    }


def _db() -> aiosqlite.Connection:
    """Open a connection to the Keera database with Row factory enabled."""
    conn = aiosqlite.connect(_DB_PATH)
    return conn


# ── tool: create_task ─────────────────────────────────────────────────────────

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
    (validation_steps). All three arrays are required and must be non-empty.

    Args:
        project_path: Absolute path of the project (use the current working directory).
        title: Short, imperative title. e.g. 'Add CSV export for tasks'.
        description: One-paragraph summary of what needs to be built and why.
        acceptance_criteria: Concrete, checkable statements defining when the task is done.
        testing_methods: How the feature will be tested (unit, integration, manual, e2e).
        validation_steps: QA / edge-case checks to perform before marking done.
        priority: Task priority — low, medium (default), or high.
        assignees: Names of people assigned to this task (can be empty).
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project = await get_project_by_path(db, project_path)
        if not project:
            return f"Error: no Keera project found at path '{project_path}'"

        title = title.strip()
        if not title:
            return "Error: title is required"

        now = _now()
        cursor = await db.execute(
            """
            INSERT INTO tasks
                (project_id, title, description, body, priority,
                 assignees, acceptance_criteria, testing_methods,
                 validation_steps, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                project["id"],
                title,
                description.strip() or title,
                description.strip() or None,
                priority or "medium",
                json.dumps(assignees or []),
                json.dumps(acceptance_criteria or []),
                json.dumps(testing_methods or []),
                json.dumps(validation_steps or []),
                now,
                now,
            ),
        )
        await db.commit()
        task_id = cursor.lastrowid

    lines = [f"✓ Task #{task_id} created: {title}", ""]
    if acceptance_criteria:
        lines.append("Acceptance criteria:")
        for c in acceptance_criteria:
            lines.append(f"  • {c}")
    return "\n".join(lines)


# ── tool: list_tasks ──────────────────────────────────────────────────────────

@mcp.tool()
async def list_tasks(
    project_path: str,
    status: str | None = None,
) -> str:
    """
    List tasks for the current Keera project, optionally filtered by status.

    Args:
        project_path: Absolute path of the project (use the current working directory).
        status: Filter by status — pending, in_progress, completed, or cancelled.
                Omit to return all tasks.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project = await get_project_by_path(db, project_path)
        if not project:
            return f"Error: no Keera project found at path '{project_path}'"

        if status:
            sql = "SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY id ASC"
            params = (project["id"], status)
        else:
            sql = "SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC"
            params = (project["id"],)

        async with db.execute(sql, params) as cursor:
            tasks = await cursor.fetchall()

    if not tasks:
        return "No tasks found."

    lines = []
    for t in tasks:
        priority = t["priority"] or "medium"
        lines.append(
            f"[{t['status']}] #{t['id']} {t['title'] or t['description']}  ({priority})"
        )
    return "\n".join(lines)


# ── tool: get_task ────────────────────────────────────────────────────────────

@mcp.tool()
async def get_task(task_id: int) -> str:
    """
    Get full details of a single task by ID.

    Args:
        task_id: The numeric task ID.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)) as cursor:
            row = await cursor.fetchone()

    if not row:
        return f"Error: task #{task_id} not found"

    t = _serialize_task(row)
    lines = [
        f"#{t['id']} {t['title']}",
        f"Status:    {t['status']}",
        f"Priority:  {t['priority']}",
        f"Assignees: {', '.join(t['assignees']) if t['assignees'] else 'none'}",
        f"Created:   {t['created_at']}",
        "",
        "Description:",
        t["description"] or "(none)",
    ]
    if t["acceptance_criteria"]:
        lines += ["", "Acceptance criteria:"] + [f"  • {c}" for c in t["acceptance_criteria"]]
    if t["testing_methods"]:
        lines += ["", "Testing methods:"] + [f"  • {m}" for m in t["testing_methods"]]
    if t["validation_steps"]:
        lines += ["", "Validation steps:"] + [f"  • {s}" for s in t["validation_steps"]]
    return "\n".join(lines)


# ── tool: update_task ────────────────────────────────────────────────────────

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
    """
    Update any fields of a task.

    Args:
        task_id: The numeric task ID.
        title: New short title.
        description: New one-paragraph description.
        body: Extended markdown body.
        priority: New priority — low, medium, or high.
        assignees: Replacement list of assignee names.
        acceptance_criteria: Replacement list of acceptance criteria.
        testing_methods: Replacement list of testing methods.
        validation_steps: Replacement list of validation steps.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)) as cursor:
            row = await cursor.fetchone()

        if not row:
            return f"Error: task #{task_id} not found"

        updates: dict[str, object] = {}
        for field in ("title", "description", "body", "priority"):
            val = locals()[field]
            if val is not None:
                updates[field] = val
        for field in ("assignees", "acceptance_criteria", "testing_methods", "validation_steps"):
            val = locals()[field]
            if val is not None:
                updates[field] = json.dumps(val)

        if not updates:
            return "No fields to update."

        updates["updated_at"] = _now()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE tasks SET {set_clause} WHERE id = ?",
            (*updates.values(), task_id),
        )
        await db.commit()

    task_title = updates.get("title") or row["title"] or row["description"]
    return f"Task #{task_id} '{task_title}' updated."


# ── tool: update_task_status ──────────────────────────────────────────────────

@mcp.tool()
async def update_task_status(task_id: int, status: str) -> str:
    """
    Change the status of a task.

    Args:
        task_id: The numeric task ID.
        status: New status — pending, in_progress, completed, or cancelled.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)) as cursor:
            row = await cursor.fetchone()

        if not row:
            return f"Error: task #{task_id} not found"

        await db.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), task_id),
        )
        await db.commit()

    task_title = row["title"] or row["description"]
    return f"Task #{task_id} '{task_title}' → {status}"


# ── tool: send_message_to_agent ───────────────────────────────────────────────

@mcp.tool()
async def send_message_to_agent(
    sender_project_path: str,
    receiver_project_path: str,
    message: str,
) -> str:
    """
    Send a message from this agent to another agent running in a different project.

    The message is persisted to the database. If the Keera app is running, the
    message will be delivered in real time to the target agent's terminal;
    otherwise it is queued and delivered when the agent next connects.

    Args:
        sender_project_path: Absolute path of the sending project (current working directory).
        receiver_project_path: Absolute path of the project whose agent should receive the message.
        message: The message content to send.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        sender = await get_project_by_path(db, sender_project_path)
        if not sender:
            return f"Error: no Keera project found at path '{sender_project_path}'"

        receiver = await get_project_by_path(db, receiver_project_path)
        if not receiver:
            return f"Error: no Keera project found at path '{receiver_project_path}'"

        content = message.strip()
        if not content:
            return "Error: message cannot be empty"

        now = _now()
        cursor = await db.execute(
            """
            INSERT INTO agent_messages
                (sender_project_id, receiver_project_id, content, status, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
            """,
            (sender["id"], receiver["id"], content, now, now),
        )
        await db.commit()
        msg_id = cursor.lastrowid
        receiver_name = receiver["name"]

    return (
        f"Message queued for '{receiver_name}' (#{msg_id}). "
        "It will be delivered in real time if the Keera app is running, "
        "otherwise on next connection."
    )


# ── tool: get_agent_messages ──────────────────────────────────────────────────

@mcp.tool()
async def get_agent_messages(
    project_path: str,
    unread_only: bool = False,
) -> str:
    """
    Get messages in the inbox for this agent (sent from other agents).

    Args:
        project_path: Absolute path of the project (use the current working directory).
        unread_only: If true, return only pending/unread messages. Default: false.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project = await get_project_by_path(db, project_path)
        if not project:
            return f"Error: no Keera project found at path '{project_path}'"

        if unread_only:
            sql = (
                "SELECT * FROM agent_messages "
                "WHERE receiver_project_id = ? AND status = 'pending' ORDER BY id ASC"
            )
        else:
            sql = (
                "SELECT * FROM agent_messages "
                "WHERE receiver_project_id = ? ORDER BY id ASC"
            )

        async with db.execute(sql, (project["id"],)) as cursor:
            messages = await cursor.fetchall()

        if not messages:
            return "No messages."

        async with db.execute("SELECT id, name FROM projects") as cursor:
            proj_rows = await cursor.fetchall()
        proj_map = {row["id"]: row["name"] for row in proj_rows}

    lines = []
    for m in messages:
        sender_name = proj_map.get(m["sender_project_id"], str(m["sender_project_id"]))
        lines.append(f"[#{m['id']}] [{m['status']}] From {sender_name}: {m['content']}")
    return "\n".join(lines)


# ── tool: list_agents ─────────────────────────────────────────────────────────

@mcp.tool()
async def list_agents(project_path: str) -> str:
    """
    List all agents registered in the current project.

    Args:
        project_path: Absolute path of the project (use the current working directory).
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project = await get_project_by_path(db, project_path)
        if not project:
            return f"Error: no Keera project found at path '{project_path}'"

        async with db.execute(
            "SELECT * FROM agents WHERE project_id = ? ORDER BY id ASC",
            (project["id"],),
        ) as cursor:
            agents = await cursor.fetchall()

    if not agents:
        return "No agents registered in this project."

    lines = [f"Agents in '{project['name']}' (project_id={project['id']}):"]
    for a in agents:
        lines.append(
            f"  - {a['name']} (ID: {a['id']}, type: {a['agent_type']}, status: {a['status']})"
        )
    return "\n".join(lines)


# ── tool: spawn_agent ─────────────────────────────────────────────────────────

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
    """
    Create a new agent in the current project.

    The agent record is created in the database immediately and will appear in
    the Keera UI the next time the sidebar refreshes. If the Keera app is running,
    the sidebar updates in real time.

    Note: Real-time agent startup (spawning a headless Claude process) requires
    the Keera app to be running. Use the Keera UI or relay_to_agent to start it.

    Args:
        project_path: Absolute path of the project (use the current working directory).
        name: Short display name for the agent (e.g. 'Backend Engineer', 'QA Bot').
        agent_type: Role type — pm, software_engineer, qa, or custom.
        system_prompt: System prompt defining the agent's role and behavior.
        message: Initial task or instruction (noted in the return value; actual
                 delivery requires the Keera app to be running).
        model: Claude model to use. Defaults to claude-sonnet-4-6.
        task_id: ID of the task this agent is working on (optional).
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project = await get_project_by_path(db, project_path)
        if not project:
            return f"Error: no Keera project found at path '{project_path}'"

        name = name.strip()
        if not name:
            return "Error: name is required"

        now = _now()
        cursor = await db.execute(
            """
            INSERT INTO agents
                (project_id, name, description, model, system_prompt,
                 agent_type, task_id, status, has_session, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', 0, ?, ?)
            """,
            (
                project["id"],
                name,
                f"{name} agent",
                model,
                (system_prompt or "").strip() or None,
                agent_type,
                task_id,
                now,
                now,
            ),
        )
        await db.commit()
        agent_id = cursor.lastrowid

    if message and message.strip():
        return (
            f"Agent '{name}' created (ID: {agent_id}). "
            f"Start the agent from the Keera UI then use relay_to_agent to send: "
            f"{message.strip()[:120]}"
        )

    return f"Agent '{name}' created (ID: {agent_id}). Use relay_to_agent to send it a task."


# ── tool: relay_to_agent ──────────────────────────────────────────────────────

@mcp.tool()
async def relay_to_agent(
    from_agent_id: int,
    to_agent_id: int,
    message: str,
) -> str:
    """
    Send a message to another agent in the same project.

    The message is persisted to the database. If the Keera app is running and
    the target agent has an active terminal session, the message is delivered
    immediately; otherwise it is queued and delivered when the agent next starts.

    Args:
        from_agent_id: Your own agent ID (from list_agents).
        to_agent_id: The ID of the agent to send the message to (from list_agents).
        message: The message or task to send.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM agents WHERE id = ?", (from_agent_id,)) as cursor:
            from_agent = await cursor.fetchone()
        if not from_agent:
            return f"Error: agent #{from_agent_id} not found"

        async with db.execute("SELECT * FROM agents WHERE id = ?", (to_agent_id,)) as cursor:
            to_agent = await cursor.fetchone()
        if not to_agent:
            return f"Error: agent #{to_agent_id} not found"

        content = message.strip()
        if not content:
            return "Error: message cannot be empty"

        now = _now()
        cursor = await db.execute(
            """
            INSERT INTO agent_relay_messages
                (from_agent_id, to_agent_id, content, status, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
            """,
            (from_agent_id, to_agent_id, content, now, now),
        )
        await db.commit()
        msg_id = cursor.lastrowid
        to_name = to_agent["name"]

    return (
        f"Message queued for agent '{to_name}' (#{msg_id}). "
        "It will be delivered in real time if the Keera app is running."
    )


# ── resource: keera://tasks/active ───────────────────────────────────────────

@mcp.resource("keera://tasks/active")
async def active_tasks() -> str:
    """
    Active Tasks — pending and in-progress tasks for this project.

    Read this at the start of every session to understand what needs doing.

    Set the KEERA_PROJECT_PATH environment variable to scope to a specific
    project. When unset, tasks from all projects are shown.
    """
    project_path = os.environ.get("KEERA_PROJECT_PATH", "").strip()

    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        project = None
        if project_path:
            project = await get_project_by_path(db, project_path)

        if not project:
            # Show active tasks across all projects
            async with db.execute(
                """
                SELECT t.*, p.name AS project_name
                FROM tasks t
                JOIN projects p ON t.project_id = p.id
                WHERE t.status IN ('pending', 'in_progress')
                ORDER BY t.project_id ASC, t.id ASC
                """
            ) as cursor:
                tasks = await cursor.fetchall()

            if not tasks:
                return (
                    "No active tasks found across all projects.\n"
                    "Tip: set KEERA_PROJECT_PATH to scope to a specific project."
                )

            lines = ["Active tasks (all projects):", ""]
            for t in tasks:
                label = "[ ]" if t["status"] == "pending" else "[→]"
                lines.append(
                    f"{label} #{t['id']} [{t['project_name']}] "
                    f"{t['title'] or t['description']}  ({t['priority'] or 'medium'})"
                )
                for c in load_json_field(t["acceptance_criteria"]):
                    lines.append(f"     • {c}")
            return "\n".join(lines)

        # Scoped to a specific project
        async with db.execute(
            """
            SELECT * FROM tasks
            WHERE project_id = ? AND status IN ('pending', 'in_progress')
            ORDER BY id ASC
            """,
            (project["id"],),
        ) as cursor:
            tasks = await cursor.fetchall()

    if not tasks:
        return f"No pending or in-progress tasks for project '{project['name']}'."

    lines = [f"Active tasks for '{project['name']}':", ""]
    for t in tasks:
        label = "[ ]" if t["status"] == "pending" else "[→]"
        lines.append(
            f"{label} #{t['id']} {t['title'] or t['description']}  ({t['priority'] or 'medium'})"
        )
        for c in load_json_field(t["acceptance_criteria"]):
            lines.append(f"     • {c}")
    return "\n".join(lines)
