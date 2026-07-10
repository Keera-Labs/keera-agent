from fastapi import Request
from fastapi.responses import JSONResponse

from app.models.AgentTemplate import AgentTemplate


def _serialize(t: AgentTemplate) -> dict:
    project_id = getattr(t, "project_id", None)
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "agent_type": t.agent_type,
        "system_prompt": t.system_prompt,
        "model": t.model,
        "permissions_allow": getattr(t, "permissions_allow", None) or [],
        "permissions_deny": getattr(t, "permissions_deny", None) or [],
        "flags": getattr(t, "flags", None) or {},
        "dangerously_skip_permissions": bool(getattr(t, "dangerously_skip_permissions", True)),
        "plan_mode": bool(getattr(t, "plan_mode", False)),
        "is_builtin": bool(getattr(t, "is_builtin", False)),
        "project_id": project_id,
        "source_template_id": getattr(t, "source_template_id", None),
        "is_override": project_id is not None,
        "created_at": str(t.created_at) if t.created_at else None,
    }


# Columns copied verbatim when forking a global template into a project override.
_COPYABLE_COLUMNS = (
    "name",
    "description",
    "agent_type",
    "system_prompt",
    "model",
    "flags",
    "permissions_allow",
    "permissions_deny",
    "dangerously_skip_permissions",
    "plan_mode",
)


def _apply_body(template: AgentTemplate, body: dict) -> None:
    """Mutate a template model in place from a request body (shared by global and
    project-scoped updates)."""
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
        template.flags = body["flags"] or {}
    if "permissions_allow" in body:
        template.permissions_allow = body["permissions_allow"] or []
    if "permissions_deny" in body:
        template.permissions_deny = body["permissions_deny"] or []
    if "dangerously_skip_permissions" in body:
        template.dangerously_skip_permissions = bool(body["dangerously_skip_permissions"])
    if "plan_mode" in body:
        template.plan_mode = bool(body["plan_mode"])


def _new_template_fields(body: dict) -> dict:
    return {
        "name": (body.get("name") or "").strip(),
        "description": (body.get("description") or "").strip() or None,
        "agent_type": (body.get("agent_type") or "software_engineer").strip(),
        "model": (body.get("model") or "claude-opus-4-8").strip(),
        "system_prompt": (body.get("system_prompt") or "").strip() or None,
        "flags": body.get("flags") or {},
        "permissions_allow": body.get("permissions_allow") or [],
        "permissions_deny": body.get("permissions_deny") or [],
        "dangerously_skip_permissions": bool(body.get("dangerously_skip_permissions", True)),
        "plan_mode": bool(body.get("plan_mode", False)),
    }


# ── GLOBAL templates (project_id NULL) ────────────────────────────────────────


async def index(request: Request):
    """List GLOBAL templates — built-ins first, then user-created alphabetically."""
    templates = await (
        AgentTemplate.where_null("project_id")
        .order_by("is_builtin", "desc")
        .order_by("name", "asc")
        .get()
    )
    return JSONResponse([_serialize(t) for t in templates])


async def store(request: Request):
    """Create a new user-defined GLOBAL template."""
    body = await request.json()
    if not (body.get("name") or "").strip():
        return JSONResponse({"error": "name is required"}, status_code=422)

    template = await AgentTemplate.create(
        {
            **_new_template_fields(body),
            "is_builtin": False,
            "project_id": None,
            "source_template_id": None,
        }
    )
    return JSONResponse(_serialize(template), status_code=201)


async def update(request: Request, template_id: int):
    """Update a GLOBAL template. Built-ins are editable too; startup seeding is
    insert-if-missing only, so edits survive a re-seed (use Sync to revert)."""
    template = await AgentTemplate.find(template_id)
    if not template:
        return JSONResponse({"error": "Template not found"}, status_code=404)

    _apply_body(template, await request.json())
    await template.save()
    return JSONResponse(_serialize(template))


async def destroy(request: Request, template_id: int):
    """Delete a user-defined GLOBAL template. Built-ins cannot be deleted."""
    template = await AgentTemplate.find(template_id)
    if not template:
        return JSONResponse({"error": "Template not found"}, status_code=404)
    if getattr(template, "is_builtin", False):
        return JSONResponse({"error": "Built-in templates cannot be deleted"}, status_code=403)
    await AgentTemplate.where("id", template_id).delete()
    return JSONResponse({"ok": True})


async def sync_defaults(request: Request):
    """Re-pull code defaults into the global built-in rows, overwriting edits."""
    from app.actions.sync_global_templates_action import SyncGlobalTemplatesAction

    synced = await SyncGlobalTemplatesAction().execute()
    return JSONResponse({"ok": True, "synced": synced})


# ── PROJECT-scoped templates (effective list + copy-on-write) ─────────────────


async def _effective_for_project(project_id: int) -> list[AgentTemplate]:
    """Resolve the effective template list for a project: a project override
    where one shadows a global, otherwise the global, plus any templates created
    fresh inside the project."""
    globals_ = await AgentTemplate.where_null("project_id").get()
    overrides = await AgentTemplate.where("project_id", project_id).get()

    override_by_source = {
        o.source_template_id: o for o in overrides if o.source_template_id is not None
    }

    effective = [override_by_source.get(g.id, g) for g in globals_]
    effective.extend(o for o in overrides if o.source_template_id is None)

    effective.sort(
        key=lambda t: (0 if getattr(t, "is_builtin", False) else 1, (t.name or "").lower())
    )
    return effective


async def project_index(request: Request, project_id: int):
    """Effective (resolved) template list for a project."""
    effective = await _effective_for_project(project_id)
    return JSONResponse([_serialize(t) for t in effective])


async def project_store(request: Request, project_id: int):
    """Create a template that lives only inside this project."""
    body = await request.json()
    if not (body.get("name") or "").strip():
        return JSONResponse({"error": "name is required"}, status_code=422)

    template = await AgentTemplate.create(
        {
            **_new_template_fields(body),
            "is_builtin": False,
            "project_id": project_id,
            "source_template_id": None,
        }
    )
    return JSONResponse(_serialize(template), status_code=201)


async def project_update(request: Request, project_id: int, template_id: int):
    """Copy-on-write edit within a project.

    - Editing an existing project override updates it in place.
    - Editing a global forks a project-scoped override (never mutates the global).
    """
    template = await AgentTemplate.find(template_id)
    if not template:
        return JSONResponse({"error": "Template not found"}, status_code=404)

    body = await request.json()
    tpl_project = getattr(template, "project_id", None)

    # Already a project row for THIS project → update in place.
    if tpl_project == project_id:
        _apply_body(template, body)
        await template.save()
        return JSONResponse(_serialize(template))

    # A row scoped to a different project is not addressable here.
    if tpl_project is not None:
        return JSONResponse({"error": "Template not found"}, status_code=404)

    # It's a global → fork (or update an existing fork of it).
    existing = await (
        AgentTemplate.where("project_id", project_id)
        .where("source_template_id", template.id)
        .first()
    )
    if existing:
        _apply_body(existing, body)
        await existing.save()
        return JSONResponse(_serialize(existing))

    fields = {col: getattr(template, col, None) for col in _COPYABLE_COLUMNS}
    override = AgentTemplate()
    for key, value in fields.items():
        setattr(override, key, value)
    override.is_builtin = False
    override.project_id = project_id
    override.source_template_id = template.id
    _apply_body(override, body)
    await override.save()
    return JSONResponse(_serialize(override), status_code=201)


async def project_destroy(request: Request, project_id: int, template_id: int):
    """Delete a project-scoped override/template. Reverts to the global (if any)."""
    template = await AgentTemplate.find(template_id)
    if not template or getattr(template, "project_id", None) != project_id:
        return JSONResponse({"error": "Template not found"}, status_code=404)
    await AgentTemplate.where("id", template_id).delete()
    return JSONResponse({"ok": True})


async def project_reset(request: Request, project_id: int):
    """Remove all of a project's overrides — revert entirely to global templates."""
    removed = await AgentTemplate.where("project_id", project_id).count()
    await AgentTemplate.where("project_id", project_id).delete()
    return JSONResponse({"ok": True, "removed": removed})
