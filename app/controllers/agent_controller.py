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
        "created_at": str(a.created_at) if a.created_at else None,
    }


async def index(request: Request, project_id: int):
    agents = await Agent.where("project_id", project_id).get()
    if not agents:
        # Auto-create a default PM agent for projects that don't have one yet
        agent = await Agent.create({
            "project_id": project_id,
            "name": "PM",
            "agent_type": "pm",
            "description": "Project manager agent that coordinates work across the team.",
            "model": "claude-sonnet-4-6",
            "system_prompt": (
                "You are a project manager AI agent. Your role is to understand the project goals, "
                "break down work into clear tasks, coordinate with other agents, and ensure delivery. "
                "Spawn specialist agents (software_engineer, qa) when needed and relay tasks to them."
            ),
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
    system_prompt = (body.get("system_prompt") or "").strip() or None

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    agent = await Agent.create({
        "project_id": project_id,
        "name": name,
        "agent_type": agent_type,
        "description": description,
        "model": model,
        "system_prompt": system_prompt,
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
    system_prompt = (body.get("system_prompt") or "").strip() or None
    message = (body.get("message") or "").strip() or None

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    agent = await Agent.create({
        "project_id": project_id,
        "name": name,
        "agent_type": agent_type,
        "description": description,
        "model": model,
        "system_prompt": system_prompt,
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


