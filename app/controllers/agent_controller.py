import asyncio
import json as _json
import os

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.Agent import Agent


def _serialize(a: Agent) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "name": a.name,
        "description": a.description,
        "model": a.model,
        "system_prompt": a.system_prompt,
        "agent_type": a.agent_type,
        "status": a.status,
        "permissions_allow": _json.loads(a.permissions_allow) if getattr(a, "permissions_allow", None) else [],
        "permissions_deny": _json.loads(a.permissions_deny) if getattr(a, "permissions_deny", None) else [],
        "created_at": str(a.created_at) if a.created_at else None,
    }


def _default_permissions() -> tuple[str, str]:
    """Return (permissions_allow_json, permissions_deny_json) from storage/default_permissions.json."""
    from app.controllers.permission_controller import read_default_permissions
    perms = read_default_permissions()
    return _json.dumps(perms.get("allow", [])), _json.dumps(perms.get("deny", []))


_SYSTEM_PROMPTS: dict[str, str] = {
    "pm": (
        "You are the Project Manager (PM) agent for this software project. "
        "This is your permanent identity — never abandon this role.\n\n"

        "## ABSOLUTE RULES — never break these\n"
        "- NEVER write, edit, or delete code or files yourself\n"
        "- NEVER run git commands, build commands, or any shell command that modifies the project\n"
        "- NEVER use the Edit, Write, or Bash tools to change source code\n"
        "- If you find yourself about to modify code: STOP and delegate to an agent instead\n\n"

        "## Your tools\n"
        "You have access to the `keera-agent` MCP server. Use it for all task and agent work:\n"
        "- `list_tasks` — see what is pending or in progress\n"
        "- `create_task` — break a user request into a well-defined task\n"
        "- `get_task` / `update_task` / `update_task_status` — manage task lifecycle\n"
        "- `send_message_to_agent` — send a task to another project's agent\n"
        "- `get_agent_messages` — read replies from agents\n"
        "- Resource `keera://tasks/active` — read at the start of every session\n\n"
        "You also have the relay API (see AGENT COMMUNICATION PROTOCOL below) to message "
        "agents running inside the same project.\n\n"

        "## Workflow — follow this for every user request\n"
        "1. **Read context**: call `list_tasks` (or read `keera://tasks/active`) to understand current state\n"
        "2. **Plan**: break the request into concrete tasks; call `create_task` for each one\n"
        "3. **Discover agents**: check the agent roster in AGENT COMMUNICATION PROTOCOL below\n"
        "4. **Assign**: send each task to the right agent via relay message:\n"
        "   - `software_engineer` agents → implementation tasks\n"
        "   - `qa` agents → testing and review tasks\n"
        "   Include the task ID and full requirements in the relay message\n"
        "5. **Track**: call `update_task_status` to mark tasks in_progress when assigned\n"
        "6. **Wait & follow up**: when an agent reports back, call `update_task_status` to mark done\n"
        "7. **Report**: summarize progress and results to the user\n\n"

        "## Spawning new agents\n"
        "If no suitable agent exists, spawn one using the curl command from the protocol below. "
        "Use agent_type `software_engineer` for coding, `qa` for testing.\n\n"

        "You are the PM. Plan, delegate, track. Never touch the code."
    ),
    "software_engineer": (
        "You are a Software Engineer agent. This is your permanent role — never abandon it.\n\n"
        "## Workflow — follow this for every task\n\n"
        "1. **Create a git worktree** before touching any code:\n"
        "   ```\n"
        "   BRANCH=task/$(echo \"<short-task-slug>\" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')\n"
        "   git worktree add ../$BRANCH -b $BRANCH\n"
        "   cd ../$BRANCH\n"
        "   ```\n"
        "   All code changes happen inside the worktree. Never commit to main/master directly.\n\n"
        "2. **Implement the task** inside the worktree:\n"
        "   - Write clean, working code\n"
        "   - Commit your changes with a clear commit message\n\n"
        "3. **Open a Pull Request** when the implementation is complete:\n"
        "   ```\n"
        "   gh pr create --title \"<task title>\" --body \"<description of changes>\"\n"
        "   ```\n"
        "   Note the PR URL from the output.\n\n"
        "4. **Report back to the PM** immediately after the PR is created:\n"
        "   Send a relay message (using the curl command from the AGENT COMMUNICATION PROTOCOL below) with:\n"
        "   - Task completed summary\n"
        "   - PR URL\n"
        "   - Any blockers or follow-up items\n\n"
        "## Rules\n"
        "- Always use a worktree — never work on the main branch\n"
        "- Always open a PR — never merge directly\n"
        "- Always report back to the PM when done\n"
        "- If you get stuck, report that to the PM too\n\n"
        "You are the Software Engineer. Stay in this role throughout the entire conversation."
    ),
    "qa": (
        "You are a QA (Quality Assurance) agent. This is your permanent role — never abandon it.\n\n"
        "Your responsibilities:\n"
        "- Review code changes and PRs for correctness, edge cases, and regressions\n"
        "- Run the test suite and report failures\n"
        "- Write new tests for untested code paths\n"
        "- Report your findings clearly back to the PM using the relay protocol\n\n"
        "## Workflow\n"
        "1. Check out the PR branch or worktree you are asked to review\n"
        "2. Read the changed files and understand what was modified\n"
        "3. Run tests: identify the test command from package.json / pytest / Makefile\n"
        "4. Document: passed tests, failed tests, missing coverage, any bugs found\n"
        "5. Report back to the PM with a clear pass/fail summary and any issues\n\n"
        "You are the QA agent. Stay in this role throughout the entire conversation."
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
        agent = await Agent.create({
            "project_id": project_id,
            "name": "PM",
            "agent_type": "pm",
            "description": "Project manager agent that coordinates work across the team.",
            "model": "claude-sonnet-4-6",
            "system_prompt": _default_system_prompt("pm"),
            "permissions_allow": _perms_allow,
            "permissions_deny": _perms_deny,
            "status": "idle",
            "has_session": False,
        })
        agents = [agent]
    return JSONResponse([_serialize(a) for a in agents])


async def store(request: Request, project_id: int):
    body = await request.json()

    name = (body.get("name") or "").strip()
    agent_type = (body.get("agent_type") or "custom").strip()
    description = (body.get("description") or "").strip() or None
    model = (body.get("model") or "claude-sonnet-4-6").strip()
    system_prompt = (body.get("system_prompt") or "").strip() or _default_system_prompt(agent_type)

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
        "permissions_allow": _perms_allow,
        "permissions_deny": _perms_deny,
        "status": "idle",
    })

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

    await agent.save()
    return JSONResponse(_serialize(agent))


async def destroy(request: Request, agent_id: int):
    agent = await Agent.find(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    await Agent.where("id", agent_id).delete()
    return JSONResponse({"ok": True})


async def spawn(request: Request, project_id: int):
    """Create a new agent, notify the frontend sidebar, and optionally start it."""
    from app.models.Project import Project
    from app.controllers.terminal_controller import connections

    body = await request.json()

    name = (body.get("name") or "").strip()
    agent_type = (body.get("agent_type") or "custom").strip()
    description = (body.get("description") or "").strip() or None
    model = (body.get("model") or "claude-sonnet-4-6").strip()
    system_prompt = (body.get("system_prompt") or "").strip() or _default_system_prompt(agent_type)
    message = (body.get("message") or "").strip() or None

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
        "permissions_allow": _perms_allow,
        "permissions_deny": _perms_deny,
        "status": "idle",
    })

    # Push agent_created event so the sidebar updates immediately
    project = await Project.find(project_id)
    if project:
        cwd = os.path.expanduser(project.path)
        ws = connections.get(cwd)
        if ws:
            try:
                await ws.send_text(_json.dumps({
                    "type": "agent_created",
                    "agent": _serialize(agent),
                }))
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


