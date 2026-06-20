import json as _json

from app.models.AgentTemplate import AgentTemplate
from app.constant.templates import AGENT_TEMPLATES, AgentTemplateSeed


def global_template_fields(tpl: AgentTemplateSeed) -> dict:
    """Map a code-defined seed to a GLOBAL agent_templates row.

    Shared by the boot seeder (insert-if-missing) and the explicit
    "sync from defaults" action (overwrite), so both write identical fields.
    """
    from app.utils.system_prompts import default_system_prompt

    return {
        "name": tpl.name,
        "description": tpl.description,
        "agent_type": tpl.agent_type,
        "system_prompt": default_system_prompt(tpl.agent_type),
        "model": tpl.model,
        "flags": _json.dumps(tpl.flags),
        "dangerously_skip_permissions": tpl.dangerously_skip_permissions,
        "plan_mode": tpl.plan_mode,
        "is_builtin": True,
        "project_id": None,
        "source_template_id": None,
    }


class SeedBuiltinTemplatesAction:
    """Seed built-in agent templates from app/constant/templates.py as GLOBAL rows.

    Insert-if-missing ONLY: an existing global built-in row is never overwritten,
    so user edits to built-ins (model, system prompt, flags, …) survive startup
    re-seeding. New built-ins are still created on first boot. Use the explicit
    "Sync from defaults" action to overwrite globals back to the code defaults.
    """

    async def execute(self) -> None:
        for tpl in AGENT_TEMPLATES:
            existing = await (
                AgentTemplate
                .where("name", tpl.name)
                .where("is_builtin", True)
                .where_null("project_id")
                .first()
            )
            if existing:
                # Never overwrite an existing global built-in — preserve edits.
                continue

            await AgentTemplate.create(global_template_fields(tpl))
