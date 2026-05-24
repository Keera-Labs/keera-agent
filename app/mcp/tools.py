"""
MCP tool definitions and handlers.

Each tool has:
  - schema()  → dict   JSON Schema fragment sent in tools/list
  - handle()  → str    called when Claude invokes the tool; returns plain text
"""

import json
import os

from app.models.Project import Project
from app.models.Task import Task

# ── helpers ───────────────────────────────────────────────────────────────────

def _load_json(value) -> list:
    if not value:
        return []
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return []


def _serialize_task(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title or t.description,
        "description": t.description,
        "body": t.body,
        "priority": t.priority or "medium",
        "status": t.status,
        "assignees": _load_json(t.assignees),
        "acceptance_criteria": _load_json(t.acceptance_criteria),
        "testing_methods": _load_json(t.testing_methods),
        "validation_steps": _load_json(t.validation_steps),
        "created_at": str(t.created_at),
    }


async def _project_by_path(path: str) -> Project | None:
    projects = await Project.all()
    expanded = os.path.expanduser(path).rstrip("/")
    for p in projects:
        if os.path.expanduser(p.path).rstrip("/") == expanded:
            return p
    return None


# ── tool: create_task ─────────────────────────────────────────────────────────

CREATE_TASK_SCHEMA = {
    "name": "create_task",
    "description": (
        "Create a well-planned task in the current Keera project. "
        "Before calling this tool, think through the full implementation plan: "
        "what 'done' looks like (acceptance_criteria), how it will be tested "
        "(testing_methods), and what edge cases / QA steps are needed "
        "(validation_steps). All three are required."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "project_path": {
                "type": "string",
                "description": "Absolute path of the project (use the current working directory).",
            },
            "title": {
                "type": "string",
                "description": "Short, imperative title. e.g. 'Add CSV export for tasks'.",
            },
            "description": {
                "type": "string",
                "description": "One-paragraph summary of what needs to be built and why.",
            },
            "acceptance_criteria": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Concrete, checkable statements that define when the task is done.",
                "minItems": 1,
            },
            "testing_methods": {
                "type": "array",
                "items": {"type": "string"},
                "description": "How the feature will be tested (unit, integration, manual, e2e).",
                "minItems": 1,
            },
            "validation_steps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "QA / edge-case checks to perform before marking done.",
                "minItems": 1,
            },
            "priority": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "Task priority. Default: medium.",
            },
            "assignees": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Names of people assigned to this task (can be empty).",
            },
        },
        "required": [
            "project_path",
            "title",
            "description",
            "acceptance_criteria",
            "testing_methods",
            "validation_steps",
        ],
    },
}


async def handle_create_task(args: dict) -> str:
    project = await _project_by_path(args["project_path"])
    if not project:
        return f"Error: no Keera project found at path '{args['project_path']}'"

    title = args["title"].strip()
    if not title:
        return "Error: title is required"

    task = await Task.create({
        "project_id": project.id,
        "title": title,
        "description": args.get("description", "").strip() or title,
        "body": args.get("description", "").strip() or None,
        "priority": args.get("priority", "medium"),
        "assignees": json.dumps(args.get("assignees") or []),
        "acceptance_criteria": json.dumps(args.get("acceptance_criteria") or []),
        "testing_methods": json.dumps(args.get("testing_methods") or []),
        "validation_steps": json.dumps(args.get("validation_steps") or []),
        "status": "pending",
    })

    ac = args.get("acceptance_criteria") or []
    lines = [f"✓ Task #{task.id} created: {title}", ""]
    if ac:
        lines.append("Acceptance criteria:")
        for c in ac:
            lines.append(f"  • {c}")
    return "\n".join(lines)


# ── tool: list_tasks ──────────────────────────────────────────────────────────

LIST_TASKS_SCHEMA = {
    "name": "list_tasks",
    "description": "List tasks for the current Keera project, optionally filtered by status.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "project_path": {
                "type": "string",
                "description": "Absolute path of the project (use the current working directory).",
            },
            "status": {
                "type": "string",
                "enum": ["pending", "in_progress", "completed", "cancelled"],
                "description": "Filter by status. Omit to return all tasks.",
            },
        },
        "required": ["project_path"],
    },
}


async def handle_list_tasks(args: dict) -> str:
    project = await _project_by_path(args["project_path"])
    if not project:
        return f"Error: no Keera project found at path '{args['project_path']}'"

    q = Task.where("project_id", project.id)
    if args.get("status"):
        q = q.where("status", args["status"])
    tasks = await q.get()

    if not tasks:
        return "No tasks found."

    lines = []
    for t in tasks:
        priority = t.priority or "medium"
        lines.append(f"[{t.status}] #{t.id} {t.title or t.description}  ({priority})")
    return "\n".join(lines)


# ── tool: get_task ────────────────────────────────────────────────────────────

GET_TASK_SCHEMA = {
    "name": "get_task",
    "description": "Get full details of a single task by ID.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "integer",
                "description": "The numeric task ID.",
            },
        },
        "required": ["task_id"],
    },
}


async def handle_get_task(args: dict) -> str:
    task = await Task.find(args["task_id"])
    if not task:
        return f"Error: task #{args['task_id']} not found"

    t = _serialize_task(task)
    lines = [
        f"#{t['id']} {t['title']}",
        f"Status:   {t['status']}",
        f"Priority: {t['priority']}",
        f"Assignees: {', '.join(t['assignees']) if t['assignees'] else 'none'}",
        f"Created:  {t['created_at']}",
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

UPDATE_TASK_SCHEMA = {
    "name": "update_task",
    "description": "Update any fields of a task (title, description, body, acceptance_criteria, testing_methods, validation_steps, priority, assignees).",
    "inputSchema": {
        "type": "object",
        "properties": {
            "task_id": {"type": "integer", "description": "The numeric task ID."},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "body": {"type": "string"},
            "priority": {"type": "string", "enum": ["low", "medium", "high"]},
            "assignees": {"type": "array", "items": {"type": "string"}},
            "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
            "testing_methods": {"type": "array", "items": {"type": "string"}},
            "validation_steps": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["task_id"],
    },
}


async def handle_update_task(args: dict) -> str:
    task = await Task.find(args["task_id"])
    if not task:
        return f"Error: task #{args['task_id']} not found"

    updatable = ["title", "description", "body", "priority"]
    json_fields = ["assignees", "acceptance_criteria", "testing_methods", "validation_steps"]

    for field in updatable:
        if field in args:
            setattr(task, field, args[field])
    for field in json_fields:
        if field in args:
            setattr(task, field, json.dumps(args[field]))

    await task.save()
    return f"Task #{task.id} '{task.title or task.description}' updated."


# ── tool: update_task_status ──────────────────────────────────────────────────

UPDATE_STATUS_SCHEMA = {
    "name": "update_task_status",
    "description": "Change the status of a task.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "integer",
                "description": "The numeric task ID.",
            },
            "status": {
                "type": "string",
                "enum": ["pending", "in_progress", "completed", "cancelled"],
            },
        },
        "required": ["task_id", "status"],
    },
}


async def handle_update_task_status(args: dict) -> str:
    task = await Task.find(args["task_id"])
    if not task:
        return f"Error: task #{args['task_id']} not found"
    task.status = args["status"]
    await task.save()
    return f"Task #{task.id} '{task.title or task.description}' → {task.status}"


# ── tool: send_message_to_agent ───────────────────────────────────────────────

SEND_MESSAGE_SCHEMA = {
    "name": "send_message_to_agent",
    "description": (
        "Send a message from this agent to another agent running in a different project. "
        "If the target agent is active, the message is delivered immediately to its terminal. "
        "Otherwise it is queued and delivered when it next connects."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "sender_project_path": {
                "type": "string",
                "description": "Absolute path of the sending project (use current working directory).",
            },
            "receiver_project_path": {
                "type": "string",
                "description": "Absolute path of the project whose agent should receive the message.",
            },
            "message": {
                "type": "string",
                "description": "The message content to send.",
            },
        },
        "required": ["sender_project_path", "receiver_project_path", "message"],
    },
}


async def handle_send_message(args: dict) -> str:
    from app.models.AgentMessage import AgentMessage
    from app.controllers.terminal_controller import pty_writers, connections
    import asyncio
    import json as _json

    sender = await _project_by_path(args["sender_project_path"])
    if not sender:
        return f"Error: no Keera project found at path '{args['sender_project_path']}'"

    receiver = await _project_by_path(args["receiver_project_path"])
    if not receiver:
        return f"Error: no Keera project found at path '{args['receiver_project_path']}'"

    content = args["message"].strip()
    if not content:
        return "Error: message cannot be empty"

    msg = await AgentMessage.create({
        "sender_project_id": sender.id,
        "receiver_project_id": receiver.id,
        "content": content,
        "status": "pending",
    })

    # Deliver immediately if receiver has an active PTY
    receiver_path = os.path.expanduser(receiver.path).rstrip("/")
    write = pty_writers.get(receiver_path) or pty_writers.get(receiver.path)
    ws = connections.get(receiver_path) or connections.get(receiver.path)

    if write:
        await asyncio.sleep(0.2)
        write(f"\n[Message from {sender.name}]: {content}\n")
        await AgentMessage.where("id", msg.id).update({"status": "delivered"})

        # Notify receiver's frontend
        if ws:
            try:
                await ws.send_text(_json.dumps({
                    "type": "agent_message",
                    "message_id": msg.id,
                    "sender_name": sender.name,
                    "content": content,
                }))
            except Exception:
                pass

        return f"Message delivered to {receiver.name} (#{msg.id})"

    return f"Message queued for {receiver.name} (#{msg.id}) — will be delivered when agent connects"


# ── tool: get_agent_messages ──────────────────────────────────────────────────

GET_MESSAGES_SCHEMA = {
    "name": "get_agent_messages",
    "description": "Get messages in the inbox for this agent (sent from other agents).",
    "inputSchema": {
        "type": "object",
        "properties": {
            "project_path": {
                "type": "string",
                "description": "Absolute path of the project (use current working directory).",
            },
            "unread_only": {
                "type": "boolean",
                "description": "If true, return only unread/pending messages. Default: false.",
            },
        },
        "required": ["project_path"],
    },
}


async def handle_get_messages(args: dict) -> str:
    from app.models.AgentMessage import AgentMessage

    project = await _project_by_path(args["project_path"])
    if not project:
        return f"Error: no Keera project found at path '{args['project_path']}'"

    q = AgentMessage.where("receiver_project_id", project.id)
    if args.get("unread_only"):
        q = q.where("status", "pending")
    messages = await q.order_by("id", "asc").get()

    if not messages:
        return "No messages."

    projects = await Project.all()
    proj_map = {p.id: p for p in projects}

    lines = []
    for m in messages:
        sender_name = proj_map[m.sender_project_id].name if m.sender_project_id in proj_map else str(m.sender_project_id)
        lines.append(f"[#{m.id}] [{m.status}] From {sender_name}: {m.content}")
    return "\n".join(lines)


# ── registry ──────────────────────────────────────────────────────────────────

TOOLS: list[dict] = [
    CREATE_TASK_SCHEMA,
    LIST_TASKS_SCHEMA,
    GET_TASK_SCHEMA,
    UPDATE_TASK_SCHEMA,
    UPDATE_STATUS_SCHEMA,
    SEND_MESSAGE_SCHEMA,
    GET_MESSAGES_SCHEMA,
]

HANDLERS: dict = {
    "create_task": handle_create_task,
    "list_tasks": handle_list_tasks,
    "get_task": handle_get_task,
    "update_task": handle_update_task,
    "update_task_status": handle_update_task_status,
    "send_message_to_agent": handle_send_message,
    "get_agent_messages": handle_get_messages,
}
