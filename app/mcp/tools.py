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
        "Send a message from this agent to another agent. "
        "If the target agent is active, the message is delivered immediately to its terminal. "
        "Otherwise it is queued and delivered when it next connects."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "sender_agent_id": {
                "type": "integer",
                "description": "Your own agent ID.",
            },
            "receiver_agent_id": {
                "type": "integer",
                "description": "The ID of the agent to send the message to.",
            },
            "message": {
                "type": "string",
                "description": "The message content to send.",
            },
        },
        "required": ["sender_agent_id", "receiver_agent_id", "message"],
    },
}


async def handle_send_message(args: dict) -> str:
    from app.models.Agent import Agent
    from app.models.AgentMessage import AgentMessage
    from fastapi_startkit.application import app as _app
    import asyncio

    sender = await Agent.find(args["sender_agent_id"])
    if not sender:
        return f"Error: agent #{args['sender_agent_id']} not found"

    receiver = await Agent.find(args["receiver_agent_id"])
    if not receiver:
        return f"Error: agent #{args['receiver_agent_id']} not found"

    content = args["message"].strip()
    if not content:
        return "Error: message cannot be empty"

    msg = await AgentMessage.create({
        "sender_project_id": sender.project_id,
        "receiver_project_id": receiver.project_id,
        "content": content,
        "status": "pending",
    })

    from app.terminal.manager import TerminalManager
    from app.terminal.websocket_terminal import WebsocketTerminal
    terminal_manager: TerminalManager = _app().make('terminal')
    terminal = terminal_manager.find(receiver.session_id) if receiver.session_id else None

    if terminal:
        # \x15 clears any pending input before injecting; \r submits
        msg_bytes = f"\x15[Message from Agent '{sender.name}']: {content}".encode()
        asyncio.create_task(WebsocketTerminal(None, terminal).run(auto_send=msg_bytes))
        await AgentMessage.where("id", msg.id).update({"status": "delivered"})
        return f"Message delivered to agent '{receiver.name}' (#{msg.id})"

    return f"Message queued for agent '{receiver.name}' (#{msg.id}) — will be delivered when agent connects"


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


# ── tool: list_agents ─────────────────────────────────────────────────────────

LIST_AGENTS_SCHEMA = {
    "name": "list_agents",
    "description": "List all agents registered in the current project.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "project_path": {
                "type": "string",
                "description": "Absolute path of the project (use the current working directory).",
            },
        },
        "required": ["project_path"],
    },
}


async def handle_list_agents(args: dict) -> str:
    from app.models.Agent import Agent

    project = await _project_by_path(args["project_path"])
    if not project:
        return f"Error: no Keera project found at path '{args['project_path']}'"

    agents = await Agent.where("project_id", project.id).get()
    if not agents:
        return "No agents registered in this project."

    lines = [f"Agents in '{project.name}' (project_id={project.id}):"]
    for a in agents:
        lines.append(f"  - {a.name} (ID: {a.id}, type: {a.agent_type}, status: {a.status})")
    return "\n".join(lines)


# ── tool: spawn_agent ─────────────────────────────────────────────────────────

SPAWN_AGENT_SCHEMA = {
    "name": "spawn_agent",
    "description": (
        "Create a new agent in the current project and optionally start it with an initial task. "
        "The new agent will appear in the sidebar immediately. "
        "Use this to delegate work to specialist agents (software_engineer, qa, custom)."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "project_path": {
                "type": "string",
                "description": "Absolute path of the project (use the current working directory).",
            },
            "name": {
                "type": "string",
                "description": "Short display name for the agent (e.g. 'Backend Engineer', 'QA Bot').",
            },
            "agent_type": {
                "type": "string",
                "enum": ["pm", "software_engineer", "qa", "custom"],
                "description": "Role type for the agent.",
            },
            "system_prompt": {
                "type": "string",
                "description": "System prompt defining the agent's role and behavior.",
            },
            "message": {
                "type": "string",
                "description": "Initial task or instruction to send to the agent after it starts. Omit to create an idle agent.",
            },
            "model": {
                "type": "string",
                "description": "Claude model to use. Defaults to claude-sonnet-4-6.",
            },
            "task_id": {
                "type": "integer",
                "description": "ID of the task this agent is working on. Required for non-PM agents. Used to name the agent's worktree.",
            },
            "from_agent_id": {
                "type": "integer",
                "description": "ID of the agent spawning this one. Sets orchestrator_id on the new agent.",
            },
        },
        "required": ["project_path", "name", "agent_type"],
    },
}


async def handle_spawn_agent(args: dict) -> str:
    import asyncio
    import json as _json
    from app.models.Agent import Agent
    from app.terminal.connection_manager import ConnectionManager
    from fastapi_startkit.application import app as _app

    project = await _project_by_path(args["project_path"])
    if not project:
        return f"Error: no Keera project found at path '{args['project_path']}'"

    name = args["name"].strip()
    if not name:
        return "Error: name is required"

    agent = await Agent.create({
        "project_id": project.id,
        "name": name,
        "agent_type": args.get("agent_type", "custom"),
        "description": f"{name} agent",
        "model": args.get("model", "claude-sonnet-4-6"),
        "system_prompt": args.get("system_prompt", "").strip() or None,
        "task_id": args.get("task_id"),
        "orchestrator_id": args.get("from_agent_id"),
        "status": "idle",
        "has_session": False,
    })

    cwd = os.path.expanduser(project.path)

    # Broadcast agent_created to all project connections so sidebar updates
    payload = _json.dumps({
        "type": "agent_created",
        "agent": {
            "id": agent.id,
            "project_id": agent.project_id,
            "name": agent.name,
            "description": agent.description,
            "model": agent.model,
            "system_prompt": agent.system_prompt,
            "agent_type": agent.agent_type,
            "status": agent.status,
            "task_id": getattr(agent, "task_id", None),
            "created_at": str(agent.created_at) if agent.created_at else None,
        },
    })
    conn_manager: ConnectionManager = _app().make('connections')
    for bridge in conn_manager.all_for_cwd(cwd):
        try:
            await bridge.send_text(payload)
        except Exception:
            pass

    # Optionally trigger the agent with an initial message
    message = (args.get("message") or "").strip()
    if message:
        from app.controllers.agent_trigger_controller import _spawn_headless_agent
        asyncio.create_task(_spawn_headless_agent(agent, project, cwd, message))
        return f"Agent '{name}' created (ID: {agent.id}) and starting with task: {message}"

    return f"Agent '{name}' created (ID: {agent.id}). Use relay_to_agent to send it a task."


# ── tool: get_orchestrated_agents ─────────────────────────────────────────────

GET_ORCHESTRATED_AGENTS_SCHEMA = {
    "name": "get_orchestrated_agents",
    "description": (
        "Return all agents that you have orchestrated (spawned). "
        "Shows their current status so you can track progress across your sub-agents."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "agent_id": {
                "type": "integer",
                "description": "Your own agent ID.",
            },
        },
        "required": ["agent_id"],
    },
}


async def handle_get_orchestrated_agents(args: dict) -> str:
    import json as _json
    from app.models.Agent import Agent

    orchestrator_id = args.get("agent_id")
    if not orchestrator_id:
        return "Error: agent_id is required"

    agents = await Agent.where("orchestrator_id", orchestrator_id).order_by("id", "asc").get()

    if not agents:
        return "You have not orchestrated any agents yet."

    rows = []
    for a in agents:
        rows.append({
            "id": a.id,
            "name": a.name,
            "agent_type": a.agent_type,
            "status": getattr(a, "status", "unknown"),
            "active": bool(getattr(a, "session_id", None)),
        })

    total = len(rows)
    active = sum(1 for r in rows if r["active"])
    summary = f"Orchestrated agents: {total} total, {active} active\n\n"
    return summary + _json.dumps(rows, indent=2)


# ── tool: relay_to_agent ──────────────────────────────────────────────────────

RELAY_TO_AGENT_SCHEMA = {
    "name": "relay_to_agent",
    "description": (
        "Send a message to another agent in the same project. "
        "If the agent is running the message is delivered immediately; "
        "otherwise it is queued and delivered when the agent next starts."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "from_agent_id": {
                "type": "integer",
                "description": "Your own agent ID.",
            },
            "to_agent_id": {
                "type": "integer",
                "description": "The ID of the agent to send the message to (from list_agents).",
            },
            "message": {
                "type": "string",
                "description": "The message or task to send.",
            },
        },
        "required": ["from_agent_id", "to_agent_id", "message"],
    },
}


async def handle_relay_to_agent(args: dict) -> str:
    from app.models.Agent import Agent
    from app.models.AgentRelayMessage import AgentRelayMessage
    from app.terminal.connection_manager import ConnectionManager
    from app.terminal.manager import TerminalManager
    from fastapi_startkit.application import app as _app
    import json as _json

    from_agent = await Agent.find(args["from_agent_id"])
    if not from_agent:
        return f"Error: agent #{args['from_agent_id']} not found"

    to_agent = await Agent.find(args["to_agent_id"])
    if not to_agent:
        return f"Error: agent #{args['to_agent_id']} not found"

    content = args["message"].strip()
    if not content:
        return "Error: message cannot be empty"

    msg = await AgentRelayMessage.create({
        "from_agent_id": from_agent.id,
        "to_agent_id": to_agent.id,
        "content": content,
        "status": "pending",
    })

    project = await Project.find(to_agent.project_id)
    if project:
        cwd = os.path.expanduser(project.path)
        conn_key = f"{cwd}:agent:{to_agent.id}"
        terminal_manager: TerminalManager = _app().make('terminal')
        if to_agent.session_id and terminal_manager.find(to_agent.session_id):
            terminal_manager.write(to_agent.session_id, f"[Message from Agent '{from_agent.name}']: {content}\r")
            await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})

            # Notify frontend
            conn_manager: ConnectionManager = _app().make('connections')
            for bridge in conn_manager.all_for_cwd(cwd):
                    try:
                        await bridge.send_text(_json.dumps({
                            "type": "agent_relay_delivered",
                            "message_id": msg.id,
                        }))
                    except Exception:
                        pass
            return f"Message delivered to agent '{to_agent.name}' (#{msg.id})"

        # Agent is idle — spawn it headlessly and deliver the message as its initial task
        import asyncio as _asyncio
        from app.controllers.agent_trigger_controller import _spawn_headless_agent
        initial_text = f"[Message from Agent '{from_agent.name}']: {content}"
        _asyncio.create_task(_spawn_headless_agent(to_agent, project, cwd, initial_text))
        await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})
        return f"Agent '{to_agent.name}' was idle — started headlessly with message (#{msg.id})"

    return f"Message queued for agent '{to_agent.name}' (#{msg.id}) — project not found"


# ── registry ──────────────────────────────────────────────────────────────────

TOOLS: list[dict] = [
    CREATE_TASK_SCHEMA,
    LIST_TASKS_SCHEMA,
    GET_TASK_SCHEMA,
    UPDATE_TASK_SCHEMA,
    UPDATE_STATUS_SCHEMA,
    SEND_MESSAGE_SCHEMA,
    GET_MESSAGES_SCHEMA,
    LIST_AGENTS_SCHEMA,
    SPAWN_AGENT_SCHEMA,
    GET_ORCHESTRATED_AGENTS_SCHEMA,
    RELAY_TO_AGENT_SCHEMA,
]

HANDLERS: dict = {
    "create_task": handle_create_task,
    "list_tasks": handle_list_tasks,
    "get_task": handle_get_task,
    "update_task": handle_update_task,
    "update_task_status": handle_update_task_status,
    "send_message_to_agent": handle_send_message,
    "get_agent_messages": handle_get_messages,
    "list_agents": handle_list_agents,
    "spawn_agent": handle_spawn_agent,
    "get_orchestrated_agents": handle_get_orchestrated_agents,
    "relay_to_agent": handle_relay_to_agent,
}
