"""MCP tool definitions — Tool subclasses for all 11 Keera tools."""

import json
import os

from pydantic import BaseModel, Field
from typing import Optional, Union

from fastapi_startkit.mcp import Tool, Response

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
        "title": t.title,
        "body": t.body,
        "priority": t.priority or "medium",
        "status": t.status,
        "assignees": _load_json(t.assignees),
        "acceptance_criteria": _load_json(t.acceptance_criteria),
        "testing_methods": _load_json(t.testing_methods),
        "validation_steps": _load_json(t.validation_steps),
        "created_at": str(t.created_at),
    }


async def _project_by_path(path: str) -> Optional[Project]:
    projects = await Project.all()
    expanded = os.path.expanduser(path).rstrip("/")
    for p in projects:
        if os.path.expanduser(p.path).rstrip("/") == expanded:
            return p
    return None


# ── create_task ───────────────────────────────────────────────────────────────

class CreateTaskInput(BaseModel):
    project_path: str = Field(description="Absolute path of the project (use the current working directory).")
    title: str = Field(description="Short, imperative title. e.g. 'Add CSV export for tasks'.")
    body: Optional[str] = Field(default=None, description="One-paragraph summary of what needs to be built and why.")
    acceptance_criteria: list[str] = Field(min_length=1, description="Concrete, checkable statements that define when the task is done.")
    testing_methods: list[str] = Field(min_length=1, description="How the feature will be tested (unit, integration, manual, e2e).")
    validation_steps: list[str] = Field(min_length=1, description="QA / edge-case checks to perform before marking done.")
    priority: str = Field(default="medium", pattern="^(low|medium|high)$", description="Task priority. Default: medium.")
    assignees: list[str] = Field(default_factory=list, description="Names of people assigned to this task (can be empty).")


class CreateTaskTool(Tool):
    name = "create_task"
    description = (
        "Create a well-planned task in the current Keera project. "
        "Before calling this tool, think through the full implementation plan: "
        "what 'done' looks like (acceptance_criteria), how it will be tested "
        "(testing_methods), and what edge cases / QA steps are needed "
        "(validation_steps). All three are required."
    )

    def schema(self):
        return CreateTaskInput

    async def handle(self, arguments: dict) -> Response:
        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(f"Error: no Keera project found at path '{arguments['project_path']}'")

        title = arguments["title"].strip()
        if not title:
            return Response.text("Error: title is required")

        task = await Task.create({
            "project_id": project.id,
            "title": title,
            "body": (arguments.get("body") or "").strip() or None,
            "priority": arguments.get("priority", "medium"),
            "assignees": json.dumps(arguments.get("assignees") or []),
            "acceptance_criteria": json.dumps(arguments.get("acceptance_criteria") or []),
            "testing_methods": json.dumps(arguments.get("testing_methods") or []),
            "validation_steps": json.dumps(arguments.get("validation_steps") or []),
            "status": "pending",
        })

        ac = arguments.get("acceptance_criteria") or []
        lines = [f"✓ Task #{task.id} created: {title}", ""]
        if ac:
            lines.append("Acceptance criteria:")
            for c in ac:
                lines.append(f"  • {c}")
        return Response.text("\n".join(lines))


# ── list_tasks ────────────────────────────────────────────────────────────────

class ListTasksInput(BaseModel):
    project_path: str = Field(description="Absolute path of the project (use the current working directory).")
    status: Optional[str] = Field(default=None, pattern="^(pending|in_progress|completed|cancelled)$", description="Filter by status. Omit to return all tasks.")


class ListTasksTool(Tool):
    name = "list_tasks"
    description = "List tasks for the current Keera project, optionally filtered by status."

    def schema(self):
        return ListTasksInput

    async def handle(self, arguments: dict) -> Response:
        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(f"Error: no Keera project found at path '{arguments['project_path']}'")

        q = Task.where("project_id", project.id)
        if arguments.get("status"):
            q = q.where("status", arguments["status"])
        tasks = await q.get()

        if not tasks:
            return Response.text("No tasks found.")

        lines = []
        for t in tasks:
            priority = t.priority or "medium"
            lines.append(f"[{t.status}] #{t.id} {t.title or t.body}  ({priority})")
        return Response.text("\n".join(lines))


# ── get_task ──────────────────────────────────────────────────────────────────

class GetTaskInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")


class GetTaskTool(Tool):
    name = "get_task"
    description = "Get full details of a single task by ID."

    def schema(self):
        return GetTaskInput

    async def handle(self, arguments: dict) -> Response:
        task = await Task.find(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")

        t = _serialize_task(task)
        lines = [
            f"#{t['id']} {t['title']}",
            f"Status:   {t['status']}",
            f"Priority: {t['priority']}",
            f"Assignees: {', '.join(t['assignees']) if t['assignees'] else 'none'}",
            f"Created:  {t['created_at']}",
            "",
            "Body:",
            t["body"] or "(none)",
        ]
        if t["acceptance_criteria"]:
            lines += ["", "Acceptance criteria:"] + [f"  • {c}" for c in t["acceptance_criteria"]]
        if t["testing_methods"]:
            lines += ["", "Testing methods:"] + [f"  • {m}" for m in t["testing_methods"]]
        if t["validation_steps"]:
            lines += ["", "Validation steps:"] + [f"  • {s}" for s in t["validation_steps"]]
        return Response.text("\n".join(lines))


# ── update_task ───────────────────────────────────────────────────────────────

class UpdateTaskInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")
    title: Optional[str] = None
    body: Optional[str] = None
    priority: Optional[str] = Field(default=None, pattern="^(low|medium|high)$")
    assignees: Optional[list[str]] = None
    acceptance_criteria: Optional[list[str]] = None
    testing_methods: Optional[list[str]] = None
    validation_steps: Optional[list[str]] = None


class UpdateTaskTool(Tool):
    name = "update_task"
    description = "Update any fields of a task (title, body, acceptance_criteria, testing_methods, validation_steps, priority, assignees)."

    def schema(self):
        return UpdateTaskInput

    async def handle(self, arguments: dict) -> Response:
        task = await Task.find(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")

        for field in ["title", "body", "priority"]:
            if field in arguments and arguments[field] is not None:
                setattr(task, field, arguments[field])
        for field in ["assignees", "acceptance_criteria", "testing_methods", "validation_steps"]:
            if field in arguments and arguments[field] is not None:
                setattr(task, field, json.dumps(arguments[field]))

        await task.save()
        return Response.text(f"Task #{task.id} '{task.title or task.body}' updated.")


# ── update_task_status ────────────────────────────────────────────────────────

class UpdateTaskStatusInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")
    status: str = Field(pattern="^(pending|in_progress|completed|cancelled)$")


class UpdateTaskStatusTool(Tool):
    name = "update_task_status"
    description = "Change the status of a task."

    def schema(self):
        return UpdateTaskStatusInput

    async def handle(self, arguments: dict) -> Response:
        task = await Task.find(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")
        task.status = arguments["status"]
        await task.save()
        return Response.text(f"Task #{task.id} '{task.title or task.body}' → {task.status}")


# ── delete_task ───────────────────────────────────────────────────────────────

class DeleteTaskInput(BaseModel):
    task_id: int = Field(description="The numeric task ID to delete.")


class DeleteTaskTool(Tool):
    name = "delete_task"
    description = "Permanently delete a task by ID."

    def schema(self):
        return DeleteTaskInput

    async def handle(self, arguments: dict) -> Response:
        task = await Task.find(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")
        title = task.title or task.body or f"#{task.id}"
        await Task.where("id", task.id).delete()
        return Response.text(f"Task '{title}' deleted.")


# ── send_message_to_agent ─────────────────────────────────────────────────────

class SendMessageInput(BaseModel):
    sender_agent_id: int = Field(description="Your own agent ID (numeric).")
    receiver_agent_id: Union[int, str] = Field(
        description="The ID (numeric) or name of the agent to send the message to."
    )
    message: str = Field(description="The message content to send.")


class SendMessageTool(Tool):
    name = "send_message_to_agent"
    description = (
        "Send a message from this agent to another agent. "
        "receiver_agent_id accepts either a numeric agent ID or the agent's name. "
        "If the target agent is active, the message is delivered immediately to its terminal. "
        "Otherwise it is queued and delivered when it next connects."
    )

    def schema(self):
        return SendMessageInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.Agent import Agent
        from app.actions.agent_message_send_action import AgentMessageSendAction

        # Validate required fields explicitly so callers get a clear error message
        missing = [
            f for f in ("sender_agent_id", "receiver_agent_id", "message")
            if f not in arguments or arguments[f] is None
        ]
        if missing:
            return Response.text(
                f"Error: missing required parameter(s): {', '.join(missing)}. "
                "Expected: sender_agent_id (int), receiver_agent_id (int or agent name), message (str)."
            )

        sender_id = arguments["sender_agent_id"]
        if not isinstance(sender_id, int):
            try:
                sender_id = int(sender_id)
            except (TypeError, ValueError):
                return Response.text(
                    f"Error: sender_agent_id must be a numeric agent ID, got '{sender_id}'. "
                    "Expected: sender_agent_id (int), receiver_agent_id (int or agent name), message (str)."
                )

        sender = await Agent.find(sender_id)
        if not sender:
            return Response.text(f"Error: agent #{sender_id} not found")

        # receiver_agent_id accepts int ID or string name
        raw_receiver = arguments["receiver_agent_id"]
        receiver = None
        if isinstance(raw_receiver, int) or (isinstance(raw_receiver, str) and raw_receiver.isdigit()):
            receiver = await Agent.find(int(raw_receiver))
            if not receiver:
                return Response.text(f"Error: agent #{raw_receiver} not found")
            if getattr(receiver, "deleted_at", None) is not None:
                return Response.text(
                    f"Error: agent {raw_receiver} is deleted and cannot receive messages."
                )
        else:
            # Look up by name (case-insensitive), skip deleted agents
            all_agents = await Agent.where_null("deleted_at").get()
            name_lower = str(raw_receiver).lower()
            for a in all_agents:
                if (a.name or "").lower() == name_lower:
                    receiver = a
                    break
            if not receiver:
                return Response.text(
                    f"Error: no agent found with name '{raw_receiver}'. "
                    "Use list_agents to see available agents and their IDs."
                )

        content = str(arguments["message"]).strip()
        if not content:
            return Response.text("Error: message cannot be empty")

        msg_id, delivered = await AgentMessageSendAction.prepare(sender, receiver, content).execute()

        if delivered:
            return Response.text(f"Message delivered to agent '{receiver.name}' (#{msg_id})")
        return Response.text(f"Message queued for agent '{receiver.name}' (#{msg_id}) — will be delivered when Claude is ready")


# ── get_agent_messages ────────────────────────────────────────────────────────

class GetAgentMessagesInput(BaseModel):
    project_path: str = Field(description="Absolute path of the project (use current working directory).")
    unread_only: bool = Field(default=False, description="If true, return only unread/pending messages.")


class GetAgentMessagesTool(Tool):
    name = "get_agent_messages"
    description = "Get messages in the inbox for this agent (sent from other agents)."

    def schema(self):
        return GetAgentMessagesInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.AgentMessage import AgentMessage

        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(f"Error: no Keera project found at path '{arguments['project_path']}'")

        q = AgentMessage.where("receiver_project_id", project.id)
        if arguments.get("unread_only"):
            q = q.where("status", "pending")
        messages = await q.order_by("id", "asc").get()

        if not messages:
            return Response.text("No messages.")

        projects = await Project.all()
        proj_map = {p.id: p for p in projects}

        lines = []
        for m in messages:
            sender_name = proj_map[m.sender_project_id].name if m.sender_project_id in proj_map else str(m.sender_project_id)
            lines.append(f"[#{m.id}] [{m.status}] From {sender_name}: {m.content}")
        return Response.text("\n".join(lines))


# ── list_agents ───────────────────────────────────────────────────────────────

class ListAgentsInput(BaseModel):
    project_path: str = Field(description="Absolute path of the project (use the current working directory).")


class ListAgentsTool(Tool):
    name = "list_agents"
    description = "List all agents registered in the current project."

    def schema(self):
        return ListAgentsInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.Agent import Agent

        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(f"Error: no Keera project found at path '{arguments['project_path']}'")

        agents = await Agent.where("project_id", project.id).where_null("deleted_at").get()
        if not agents:
            return Response.text("No agents registered in this project.")

        lines = [f"Agents in '{project.name}' (project_id={project.id}):"]
        for a in agents:
            lines.append(f"  - {a.name} (ID: {a.id}, type: {a.agent_type}, status: {a.status})")
        return Response.text("\n".join(lines))


# ── spawn_agent ───────────────────────────────────────────────────────────────

class SpawnAgentInput(BaseModel):
    project_path: str = Field(description="Absolute path of the project (use the current working directory).")
    name: str = Field(description="Short display name for the agent (e.g. 'Backend Engineer', 'QA Bot').")
    agent_type: str = Field(pattern="^(pm|software_engineer|software_engineer_frontend|reviewer|qa|qa_browser)$", description="Role type for the agent.")
    system_prompt: Optional[str] = Field(default=None, description="System prompt defining the agent's role and behavior.")
    message: Optional[str] = Field(default=None, description="Initial task or instruction to send to the agent after it starts. Omit to create an idle agent.")
    model: Optional[str] = Field(default=None, description="Claude model to use. Defaults to claude-sonnet-4-6.")
    task_id: Optional[int] = Field(default=None, description="ID of the task this agent is working on.")
    from_agent_id: Optional[int] = Field(default=None, description="ID of the agent spawning this one. Sets orchestrator_id on the new agent.")


class SpawnAgentTool(Tool):
    name = "spawn_agent"
    description = (
        "Create a new agent in the current project and optionally start it with an initial task. "
        "The new agent will appear in the sidebar immediately. "
        "Use this to delegate work to specialist agents (software_engineer, qa, reviewer, pm)."
    )

    def schema(self):
        return SpawnAgentInput

    async def handle(self, arguments: dict) -> Response:
        import asyncio
        from app.actions.agent_create_action import AgentCreateAction
        from app.controllers.global_settings_controller import read_global_settings
        from app.models.Agent import Agent as _Agent
        from app.requests.agent_requests import AgentStoreRequest
        from app.terminal.connection_manager import ConnectionManager
        from fastapi_startkit.application import app as _app

        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(f"Error: no Keera project found at path '{arguments['project_path']}'")

        name = (arguments.get("name") or "").strip()
        if not name:
            return Response.text("Error: name is required")

        # Enforce per-project agent limit before creating
        settings = await read_global_settings()
        limit = int(settings.get("max_agents_per_project", 10))
        count = await _Agent.where("project_id", project.id).where_null("deleted_at").count()
        if count >= limit:
            return Response.text(
                f"Error: agent limit ({limit}) reached for project '{project.name}'. Delete an agent first."
            )

        try:
            agent = await AgentCreateAction(
                project_id=project.id,
                request=AgentStoreRequest(
                    name=name,
                    agent_type=arguments.get("agent_type", "software_engineer"),
                    model=arguments.get("model") or "claude-sonnet-4-6",
                    description=f"{name} agent",
                    system_prompt=(arguments.get("system_prompt") or "").strip() or None,
                    task_id=arguments.get("task_id"),
                    orchestrator_id=arguments.get("from_agent_id"),
                ),
            ).execute()
        except ValueError as e:
            return Response.text(f"Error: {e}")

        cwd = os.path.expanduser(project.path)

        payload = json.dumps({
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

        message = (arguments.get("message") or "").strip()
        if message:
            from app.controllers.agent_trigger_controller import _spawn_headless_agent
            asyncio.create_task(_spawn_headless_agent(agent, project, cwd, message))
            return Response.text(f"Agent '{name}' created (ID: {agent.id}) and starting with task: {message}")

        return Response.text(f"Agent '{name}' created (ID: {agent.id}). Use send_message_to_agent to send it a task.")


# ── get_orchestrated_agents ───────────────────────────────────────────────────

class GetOrchestratedAgentsInput(BaseModel):
    agent_id: int = Field(description="Your own agent ID.")


class GetOrchestratedAgentsTool(Tool):
    name = "get_orchestrated_agents"
    description = (
        "Return all agents that you have orchestrated (spawned). "
        "Shows their current status so you can track progress across your sub-agents."
    )

    def schema(self):
        return GetOrchestratedAgentsInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.Agent import Agent

        orchestrator_id = arguments.get("agent_id")
        if not orchestrator_id:
            return Response.text("Error: agent_id is required")

        agents = await Agent.where("orchestrator_id", orchestrator_id).order_by("id", "asc").get()

        if not agents:
            return Response.text("You have not orchestrated any agents yet.")

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
        return Response.text(summary + json.dumps(rows, indent=2))


# ── delete_agent ──────────────────────────────────────────────────────────────

class DeleteAgentInput(BaseModel):
    agent_id: int = Field(description="ID of the agent to delete.")


class DeleteAgentTool(Tool):
    name = "delete_agent"
    description = (
        "Soft-delete an agent by ID. "
        "The agent is marked as deleted (deleted_at is set) and will no longer appear in agent lists. "
        "Use this to remove agents that are no longer needed."
    )

    def schema(self):
        return DeleteAgentInput

    async def handle(self, arguments: dict) -> Response:
        import datetime
        from app.models.Agent import Agent

        agent_id = arguments.get("agent_id")
        if not agent_id:
            return Response.text("Error: agent_id is required")

        agent = await Agent.find(agent_id)
        if not agent:
            return Response.text(f"Error: no agent found with ID {agent_id}")

        if getattr(agent, "deleted_at", None):
            return Response.text(f"Error: agent {agent_id} has already been deleted")

        agent.deleted_at = datetime.datetime.utcnow()
        await agent.save()

        return Response.text(f"Agent '{agent.name}' (ID: {agent_id}) has been deleted.")


# ── tool list ─────────────────────────────────────────────────────────────────

KEERA_TOOLS = [
    CreateTaskTool,
    ListTasksTool,
    GetTaskTool,
    UpdateTaskTool,
    UpdateTaskStatusTool,
    DeleteTaskTool,
    SendMessageTool,
    GetAgentMessagesTool,
    ListAgentsTool,
    SpawnAgentTool,
    GetOrchestratedAgentsTool,
    DeleteAgentTool,
]
