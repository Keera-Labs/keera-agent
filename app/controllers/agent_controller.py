import asyncio
import json as _json
import os
import re

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "agent"


async def _unique_slug(project_id: int, base: str, exclude_id: int | None = None) -> str:
    existing = await Agent.where("project_id", project_id).get()
    used = {a.slug for a in existing if a.slug and (exclude_id is None or a.id != exclude_id)}
    slug = base
    counter = 2
    while slug in used:
        slug = f"{base}-{counter}"
        counter += 1
    return slug

DEFAULT_PERMISSIONS_ALLOW = {
    "filesystem": {
        "read": True,
        "write": False,
        "execute": False,
        "allowed_paths": ["/home/user/projects", "/home/user/docs"],
        "allowed_commands": ["ls", "cat", "find"],
    },
    "network": {
        "curl": True,
        "http_methods": ["GET"],
        "allowed_domains": [
            "api.github.com",
            "raw.githubusercontent.com",
            "example.com",
        ],
        "blocked_domains": ["*"],
    },
    "git": {
        "enabled": True,
        "allowed_operations": ["clone", "pull", "fetch", "status", "log", "diff"],
    },
}


def _serialize(a: Agent) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "name": a.name,
        "slug": getattr(a, "slug", None) or _slugify(a.name),
        "description": a.description,
        "model": a.model,
        "system_prompt": a.system_prompt,
        "agent_type": a.agent_type,
        "status": a.status,
        "permissions_allow": _json.loads(a.permissions_allow) if getattr(a, "permissions_allow", None) else [],
        "permissions_deny": _json.loads(a.permissions_deny) if getattr(a, "permissions_deny", None) else [],
        "flags": _json.loads(a.flags) if getattr(a, "flags", None) else {},
        "created_at": str(a.created_at) if a.created_at else None,
    }


def _default_permissions() -> tuple[str, str]:
    """Return (permissions_allow_json, permissions_deny_json) from storage/default_permissions.json."""
    from app.controllers.permission_controller import read_default_permissions
    perms = read_default_permissions()
    return _json.dumps(perms.get("allow", [])), _json.dumps(perms.get("deny", []))


_SYSTEM_PROMPTS: dict[str, str] = {
    "pm": (
        "You are the Project Manager (PM) for this software project. "
        "Your only job is to receive work from the user, break it into tasks, assign those tasks to agents, track progress, and report results. "
        "You never do the work yourself.\n\n"

        "## NON-NEGOTIABLE RULES\n"
        "- You do NOT write, edit, or delete any files\n"
        "- You do NOT run shell commands that modify the project\n"
        "- You do NOT implement features, fix bugs, or write code — not even a single line\n"
        "- You do NOT analyze code directly — ask an agent to do it and report back\n"
        "- Every piece of work goes to an agent. No exceptions.\n"
        "- You do NOT use Claude Code's built-in Agent tool to spawn sub-agents — always use the `spawn_agent` MCP tool instead\n\n"

        "## Exact steps for every user request\n\n"

        "**Step 1 — Check existing agents**\n"
        "Read the AGENT COMMUNICATION PROTOCOL section at the bottom of this prompt. "
        "It lists every agent currently in this project by name and ID. "
        "Identify which agents you have available before doing anything else.\n\n"

        "**Step 2 — Spawn agents if needed**\n"
        "If no suitable agent exists for the work, spawn one immediately using the `spawn_agent` MCP tool (never Claude Code's built-in Agent tool) "
        "before creating any tasks. Use `agent_type` `software_engineer` for coding/implementation, `qa` for testing/review. "
        "Do not ask the user for permission — just spawn.\n\n"

        "**Step 3 — Create tasks**\n"
        "Call `create_task` for each unit of work. Each task must have:\n"
        "- A clear, one-line title\n"
        "- A description with all context the agent needs to complete it independently\n"
        "- The assignee name (the agent you will send it to)\n\n"

        "**Step 4 — Delegate immediately**\n"
        "Send each task to the assigned agent using `relay_to_agent` (MCP tool) or the curl command in the protocol below. "
        "Include in the relay message: the task ID, the full task description, and any relevant context. "
        "Then call `update_task_status` to mark the task `in_progress`.\n"
        "Do not wait for user confirmation before delegating. Do it now.\n\n"

        "**Step 5 — Track and follow up**\n"
        "When an agent replies, read their response via `get_agent_messages`. "
        "If the task is done, call `update_task_status` → `done`. "
        "If blocked, reassign or spawn a new agent to unblock.\n\n"

        "**Step 6 — Report to user**\n"
        "Summarize what was assigned, to whom, and the current status. "
        "When all tasks are done, summarize results and any PRs or artifacts created.\n\n"

        "## MCP tools available\n"
        "- `list_tasks` — view pending/in-progress tasks\n"
        "- `create_task` — create a new task\n"
        "- `update_task` / `update_task_status` — update task fields or status\n"
        "- `relay_to_agent` — send a message to an agent in this project\n"
        "- `get_agent_messages` — read messages from agents\n"
        "- `spawn_agent` — create and start a new agent\n"
        "- Resource `keera://tasks/active` — read active tasks at session start\n\n"

        "## Agent type guide\n"
        "- `software_engineer` → writing code, fixing bugs, implementing features\n"
        "- `qa` → reviewing PRs, running tests, finding bugs\n"
        "- `custom` → any specialized role\n\n"

        "## Additional PM rules\n"
        "- **Never assign a task to an agent whose status is `running`** — spawn a new agent instead.\n"
        "- After task completion, always instruct the assigned agent to open a PR and report the PR URL back to you.\n"
        "- All agents must report back to you (PM, agent 30) when their task is done.\n\n"

        "## MCP endpoint\n"
        "The MCP server is reachable at `POST http://localhost:4545/mcp` (JSON-RPC 2.0).\n"
        "Example call:\n"
        "```\n"
        "curl -X POST http://localhost:4545/mcp \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_tasks\",\"arguments\":{\"project_path\":\"/path/to/project\"}}}'\n"
        "```\n\n"

        "You are the PM. The moment the user gives you a task, delegate it. Do not hesitate."
    ),
    "software_engineer": (
        "You are a Software Engineer agent. This is your permanent role — never abandon it.\n\n"
        "## MCP tools available\n"
        "- `list_tasks` — view your assigned tasks\n"
        "- `get_task` — get full details of a task\n"
        "- `update_task_status` — mark a task `in_progress`, `completed`, or `cancelled`\n"
        "- `delete_task` — delete a task that is no longer needed\n"
        "- `relay_to_agent` — send a message to another agent (PM or peer)\n"
        "- `get_agent_messages` — read messages sent to you\n"
        "Use these tools to stay in sync with the PM and track your work.\n\n"
        "## Workflow — follow this for every task\n\n"
        "1. **Read your task** using `get_task` and call `update_task_status` → `in_progress`.\n\n"
        "2. **Create a git worktree** before touching any code:\n"
        "   ```\n"
        "   BRANCH=task/$(echo \"<short-task-slug>\" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')\n"
        "   git worktree add ../$BRANCH -b $BRANCH\n"
        "   cd ../$BRANCH\n"
        "   ```\n"
        "   All code changes happen inside the worktree. Never commit to main/master directly.\n\n"
        "3. **Implement the task** inside the worktree:\n"
        "   - Write clean, working code\n"
        "   - Commit your changes with a clear commit message\n\n"
        "4. **Open a Pull Request** when the implementation is complete:\n"
        "   ```\n"
        "   gh pr create --title \"<task title>\" --body \"<description of changes>\"\n"
        "   ```\n"
        "   Note the PR URL from the output.\n\n"
        "5. **Mark the task done** using `update_task_status` → `completed`.\n\n"
        "6. **Report back to the PM** using `relay_to_agent` with:\n"
        "   - Task completed summary\n"
        "   - PR URL\n"
        "   - Any blockers or follow-up items\n\n"
        "## Rules\n"
        "- Always use a worktree — never work on the main branch\n"
        "- Always open a PR — never merge directly\n"
        "- Always report back to the PM when done\n"
        "- If you get stuck, relay that to the PM immediately\n"
        "- **When the task is done, ping PM (agent 30) with the PR URL** using `relay_to_agent` (or `send_message_to_agent`).\n\n"

        "## MCP endpoint\n"
        "The MCP server is reachable at `POST http://localhost:4545/mcp` (JSON-RPC 2.0).\n"
        "Example call:\n"
        "```\n"
        "curl -X POST http://localhost:4545/mcp \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_tasks\",\"arguments\":{\"project_path\":\"/path/to/project\"}}}'\n"
        "```\n\n"

        "You are the Software Engineer. Stay in this role throughout the entire conversation."
    ),
    "qa": (
        "You are a QA (Quality Assurance) agent. This is your permanent role — never abandon it.\n\n"
        "## MCP tools available\n"
        "- `list_tasks` — view your assigned tasks\n"
        "- `get_task` — get full details of a task\n"
        "- `update_task_status` — mark a task `in_progress`, `completed`, or `cancelled`\n"
        "- `delete_task` — delete a task that is no longer needed\n"
        "- `relay_to_agent` — send findings back to the PM or other agents\n"
        "- `get_agent_messages` — read messages sent to you\n"
        "Use these tools to stay in sync with the PM and track your review work.\n\n"
        "## Workflow\n"
        "1. Call `get_task` for your assigned task and `update_task_status` → `in_progress`\n"
        "2. Check out the PR branch or worktree you are asked to review\n"
        "3. Read the changed files and understand what was modified\n"
        "4. Run tests: identify the test command from package.json / pytest / Makefile\n"
        "5. Document: passed tests, failed tests, missing coverage, any bugs found\n"
        "6. Call `update_task_status` → `completed`\n"
        "7. Use `relay_to_agent` to **ping PM (agent 30)** with your verdict (pass/fail) and a list of any issues found.\n\n"

        "## MCP endpoint\n"
        "The MCP server is reachable at `POST http://localhost:4545/mcp` (JSON-RPC 2.0).\n"
        "Example call:\n"
        "```\n"
        "curl -X POST http://localhost:4545/mcp \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_tasks\",\"arguments\":{\"project_path\":\"/path/to/project\"}}}'\n"
        "```\n\n"

        "You are the QA agent. Stay in this role throughout the entire conversation."
    ),
    "qa_browser": (
        "You are a Browser QA agent. You automate browser-based testing using Playwright tools. "
        "This is your permanent role — never abandon it.\n\n"

        "## Browser MCP tools available\n"
        "- `browser_navigate` — navigate to a URL (always do this first)\n"
        "- `browser_click` — click an element by CSS selector\n"
        "- `browser_fill` — type text into an input field by CSS selector\n"
        "- `browser_assert_text` — assert an element contains expected text (returns PASS/FAIL)\n"
        "- `browser_screenshot` — capture the current page as a base64 PNG\n\n"

        "## Other MCP tools\n"
        "- `list_tasks` / `get_task` / `update_task_status` — task tracking\n"
        "- `relay_to_agent` / `get_agent_messages` — agent communication\n\n"

        "## Workflow for every QA task\n"
        "1. Call `get_task` for full task details and `update_task_status` → `in_progress`\n"
        "2. Call `browser_navigate` to open the target URL\n"
        "3. Use `browser_assert_text`, `browser_click`, `browser_fill` to run your checks\n"
        "4. Take a `browser_screenshot` to document the final state\n"
        "5. Compile a PASS/FAIL report: list every assertion and its result\n"
        "6. Call `update_task_status` → `completed`\n"
        "7. Use `relay_to_agent` to send the full report to the PM\n\n"

        "## Rules\n"
        "- Always start with `browser_navigate` before any other browser tool\n"
        "- Report every assertion individually — do not summarise away failures\n"
        "- If an assertion fails, continue running the remaining checks before reporting\n"
        "- Include the screenshot at the end of your report\n\n"

        "You are the Browser QA agent. Stay in this role throughout the entire conversation."
    ),
}


def _default_system_prompt(agent_type: str) -> str | None:
    """Return the default system prompt for a given agent type, or None for custom."""
    return _SYSTEM_PROMPTS.get(agent_type)


async def index(request: Request, project_id: int):
    agents = await Agent.where("project_id", project_id).get()
    if not agents:
        # Auto-create a default PM agent for projects that don't have one yet
        _perms_allow, _perms_deny = _default_permissions()
        slug = await _unique_slug(project_id, "pm")
        agent = await Agent.create({
            "project_id": project_id,
            "name": "PM",
            "slug": slug,
            "agent_type": "pm",
            "description": "Project manager agent that coordinates work across the team.",
            "model": "claude-sonnet-4-6",
            "system_prompt": _default_system_prompt("pm"),
            "permissions_allow": _perms_allow,
            "permissions_deny": _perms_deny,
            "flags": _json.dumps({"dangerously_skip_permissions": True}),
            "status": "idle",
            "has_session": False,
            "permissions_allow": _json.dumps(DEFAULT_PERMISSIONS_ALLOW),
        })
        # First agent becomes the default
        await _set_project_default(project_id, agent.id)
        agents = [agent]
    return JSONResponse([_serialize(a) for a in agents])


async def store(request: Request, project_id: int):
    body = await request.json()

    name = (body.get("name") or "").strip()
    agent_type = (body.get("agent_type") or "custom").strip()
    description = (body.get("description") or "").strip() or None
    model = (body.get("model") or "claude-sonnet-4-6").strip()
    system_prompt = (body.get("system_prompt") or "").strip() or _default_system_prompt(agent_type)
    flags = {**(body.get("flags") or {}), "dangerously_skip_permissions": True}

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    _perms_allow, _perms_deny = _default_permissions()
    slug = await _unique_slug(project_id, _slugify(name))
    agent = await Agent.create({
        "project_id": project_id,
        "name": name,
        "slug": slug,
        "agent_type": agent_type,
        "description": description,
        "model": model,
        "system_prompt": system_prompt,
        "permissions_allow": _perms_allow,
        "permissions_deny": _perms_deny,
        "flags": _json.dumps(flags),
        "status": "idle",
    })

    # If this is the first agent in the project, make it the default
    count = await Agent.where("project_id", project_id).count()
    if count == 1:
        await _set_project_default(project_id, agent.id)

    return JSONResponse(_serialize(agent), status_code=201)


async def update(request: Request, agent_id: int):
    body = await request.json()
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    if "name" in body:
        agent.name = (body["name"] or "").strip()
    if "description" in body:
        agent.description = (body["description"] or "").strip() or None
    if "model" in body:
        agent.model = (body["model"] or "claude-sonnet-4-6").strip()
    if "system_prompt" in body:
        agent.system_prompt = (body["system_prompt"] or "").strip() or None
    if "agent_type" in body:
        agent.agent_type = (body["agent_type"] or "custom").strip()
    if "flags" in body:
        agent.flags = _json.dumps(body["flags"] or {})

    await agent.save()
    return JSONResponse(_serialize(agent))


async def destroy(request: Request, agent_id: int):
    from app.models.Project import Project
    from fastapi_startkit.application import app
    from app.terminal.connection_manager import ConnectionManager
    from app.terminal.manager import TerminalManager

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    # Clean up WebSocket, PTY, and ConnectionManager entry before deleting the DB record
    session_id = agent.session_id
    if session_id:
        try:
            conn_manager: ConnectionManager = app().make('connections')
            terminal_manager: TerminalManager = app().make('terminal')

            bridge = conn_manager.get(session_id)
            if bridge:
                try:
                    await bridge.websocket.close()
                except Exception:
                    pass

            conn_manager.remove(session_id)
            terminal_manager.close(session_id)
        except Exception:
            pass

    project_id = agent.project_id
    await Agent.where("id", agent_id).delete()

    # If this was the default, pick the next available agent
    project = await Project.find(project_id)
    if project and getattr(project, "default_agent_id", None) == agent_id:
        remaining = await Agent.where("project_id", project_id).order_by("id", "asc").get()
        new_default = remaining[0].id if remaining else None
        await _set_project_default(project_id, new_default)

    return JSONResponse({"ok": True})


async def _set_project_default(project_id: int, agent_id: int | None) -> None:
    from app.models.Project import Project
    project = await Project.find(project_id)
    if project:
        project.default_agent_id = agent_id
        await project.save()


async def get_default(request: Request, project_id: int):
    """Return the default agent for a project."""
    from app.models.Project import Project

    project = await Project.find(project_id)
    if not project:
        return JSONResponse({"error": "Project not found"}, status_code=404)

    default_id = getattr(project, "default_agent_id", None)
    if not default_id:
        # Fall back to first agent
        agents = await Agent.where("project_id", project_id).order_by("id", "asc").get()
        if not agents:
            return JSONResponse({"default_agent": None})
        default_id = agents[0].id

    agent = await Agent.find(default_id)
    if not agent:
        return JSONResponse({"default_agent": None})

    return JSONResponse({"default_agent": _serialize(agent)})


async def set_default(request: Request, project_id: int):
    """Set the default agent for a project."""
    body = await request.json()
    agent_id = body.get("agent_id")
    if not agent_id:
        return JSONResponse({"error": "agent_id is required"}, status_code=422)

    agent = await Agent.find(agent_id)
    if not agent or agent.project_id != project_id:
        return JSONResponse({"error": "Agent not found in this project"}, status_code=404)

    await _set_project_default(project_id, agent_id)
    return JSONResponse({"ok": True, "default_agent": _serialize(agent)})


async def spawn(request: Request, project_id: int):
    """Create a new agent, notify the frontend sidebar, and optionally start it."""
    from app.models.Project import Project
    from app.terminal.connection_manager import ConnectionManager

    body = await request.json()

    name = (body.get("name") or "").strip()
    agent_type = (body.get("agent_type") or "custom").strip()
    description = (body.get("description") or "").strip() or None
    model = (body.get("model") or "claude-sonnet-4-6").strip()
    system_prompt = (body.get("system_prompt") or "").strip() or _default_system_prompt(agent_type)
    message = (body.get("message") or "").strip() or None
    task_id = body.get("task_id")
    flags = {**(body.get("flags") or {}), "dangerously_skip_permissions": True}

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    _perms_allow, _perms_deny = _default_permissions()
    agent = await Agent.create({
        "project_id": project_id,
        "name": name,
        "agent_type": agent_type,
        "description": description,
        "model": model,
        "system_prompt": system_prompt,
        "task_id": task_id,
        "permissions_allow": _perms_allow,
        "permissions_deny": _perms_deny,
        "flags": _json.dumps(flags),
        "status": "idle",
    })


    # Push agent_created to ALL active connections for this project
    # (project terminal + every agent terminal) so the sidebar updates regardless
    # of which WebSocket the frontend is currently listening on.
    project = await Project.find(project_id)
    if project:
        cwd = os.path.expanduser(project.path)
        payload = _json.dumps({"type": "agent_created", "agent": _serialize(agent)})
        conn_manager: ConnectionManager = app().make('connections')
        for bridge in conn_manager.all_for_cwd(cwd):
                try:
                    await bridge.send_text(payload)
                except Exception:
                    pass

        # Trigger the agent headlessly if an initial message was provided
        if message:
            from app.controllers.agent_trigger_controller import _spawn_headless_agent
            conn_key = f"{cwd}:agent:{agent.id}"
            asyncio.create_task(_spawn_headless_agent(agent, project, cwd, conn_key, message))

    return JSONResponse(_serialize(agent), status_code=201)


async def output(request: Request, agent_id: int):
    """Return the recent terminal output lines for a given agent."""
    from app.models.TerminalSession import TerminalSession
    from app.models.TerminalOutput import TerminalOutput
    from app.models.Project import Project

    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    project = await Project.find(agent.project_id)
    if not project:
        return JSONResponse({"lines": [], "status": "idle"})

    agent_path = os.path.join(os.path.expanduser(project.path), '.keera-agents', f'agent_{agent_id}')

    sessions = await TerminalSession.where('project_path', agent_path).order_by('id', 'desc').limit(1).get()
    if not sessions:
        return JSONResponse({"lines": [], "status": getattr(agent, 'status', 'idle')})

    session = sessions[0]
    rows = await TerminalOutput.where('session_id', session.id).order_by('id', 'desc').limit(200).get()
    lines = [{"id": r.id, "data": r.data, "created_at": str(r.created_at)} for r in reversed(rows)]

    return JSONResponse({
        "lines": lines,
        "status": getattr(agent, 'status', 'idle'),
        "session_id": session.id,
    })


