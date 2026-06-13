import json as _json

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.AgentTemplate import AgentTemplate


def _serialize(t: AgentTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "agent_type": t.agent_type,
        "system_prompt": t.system_prompt,
        "model": t.model,
        "permissions_allow": _json.loads(t.permissions_allow) if getattr(t, "permissions_allow", None) else [],
        "permissions_deny": _json.loads(t.permissions_deny) if getattr(t, "permissions_deny", None) else [],
        "flags": _json.loads(t.flags) if getattr(t, "flags", None) else {},
        "dangerously_skip_permissions": bool(getattr(t, "dangerously_skip_permissions", True)),
        "plan_mode": bool(getattr(t, "plan_mode", False)),
        "is_builtin": bool(getattr(t, "is_builtin", False)),
        "created_at": str(t.created_at) if t.created_at else None,
    }


# ── CRUD handlers ─────────────────────────────────────────────────────────────

async def index(request: Request):
    """List all templates — built-ins first, then user-created alphabetically."""
    templates = await AgentTemplate.order_by("is_builtin", "desc").order_by("name", "asc").get()
    return JSONResponse([_serialize(t) for t in templates])


async def store(request: Request):
    """Create a new user-defined template."""
    body = await request.json()

    name = (body.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "name is required"}, status_code=422)

    agent_type = (body.get("agent_type") or "software_engineer").strip()
    description = (body.get("description") or "").strip() or None
    model = (body.get("model") or "claude-opus-4-8").strip()
    system_prompt = (body.get("system_prompt") or "").strip() or None
    flags = body.get("flags") or {}
    permissions_allow = body.get("permissions_allow") or []
    permissions_deny = body.get("permissions_deny") or []
    dangerously_skip_permissions = bool(body.get("dangerously_skip_permissions", True))
    plan_mode = bool(body.get("plan_mode", agent_type == "pm"))

    template = await AgentTemplate.create({
        "name": name,
        "description": description,
        "agent_type": agent_type,
        "system_prompt": system_prompt,
        "model": model,
        "flags": _json.dumps(flags),
        "permissions_allow": _json.dumps(permissions_allow),
        "permissions_deny": _json.dumps(permissions_deny),
        "dangerously_skip_permissions": dangerously_skip_permissions,
        "plan_mode": plan_mode,
        "is_builtin": False,
    })

    return JSONResponse(_serialize(template), status_code=201)


async def update(request: Request, template_id: int):
    """Update a user-defined template. Built-ins cannot be modified."""
    template = await AgentTemplate.find(template_id)
    if not template:
        return JSONResponse({"error": "Template not found"}, status_code=404)
    if getattr(template, "is_builtin", False):
        return JSONResponse({"error": "Built-in templates cannot be modified"}, status_code=403)

    body = await request.json()
    if "name" in body:
        template.name = (body["name"] or "").strip()
    if "description" in body:
        template.description = (body["description"] or "").strip() or None
    if "agent_type" in body:
        template.agent_type = (body["agent_type"] or "software_engineer").strip()
    if "system_prompt" in body:
        template.system_prompt = (body["system_prompt"] or "").strip() or None
    if "model" in body:
        template.model = (body["model"] or "claude-opus-4-8").strip()
    if "flags" in body:
        template.flags = _json.dumps(body["flags"] or {})
    if "permissions_allow" in body:
        template.permissions_allow = _json.dumps(body["permissions_allow"] or [])
    if "permissions_deny" in body:
        template.permissions_deny = _json.dumps(body["permissions_deny"] or [])
    if "dangerously_skip_permissions" in body:
        template.dangerously_skip_permissions = bool(body["dangerously_skip_permissions"])
    if "plan_mode" in body:
        template.plan_mode = bool(body["plan_mode"])

    await template.save()
    return JSONResponse(_serialize(template))


async def destroy(request: Request, template_id: int):
    """Delete a user-defined template. Built-ins cannot be deleted."""
    template = await AgentTemplate.find(template_id)
    if not template:
        return JSONResponse({"error": "Template not found"}, status_code=404)
    if getattr(template, "is_builtin", False):
        return JSONResponse({"error": "Built-in templates cannot be deleted"}, status_code=403)
    await AgentTemplate.where("id", template_id).delete()
    return JSONResponse({"ok": True})
