import json as _json

from app.models.AgentTemplate import AgentTemplate
from app.constant.templates import AGENT_TEMPLATES


class SeedBuiltinTemplatesAction:
    """Seed built-in agent templates from app/constant/templates.py.

    Insert-if-missing ONLY: an existing built-in row is never overwritten, so
    user edits to built-ins (model, system prompt, flags, …) survive startup
    re-seeding. New built-ins are still created on first boot.
    """

    async def execute(self) -> None:
        from app.utils.system_prompts import default_system_prompt

        for tpl in AGENT_TEMPLATES:
            existing = await AgentTemplate.where("name", tpl.name).where("is_builtin", True).first()
            if existing:
                # Never overwrite an existing built-in — preserve user edits.
                continue

            # Resolve the canonical system prompt via the Jinja2 loader
            system_prompt = default_system_prompt(tpl.agent_type)
            canonical_flags = _json.dumps(tpl.flags)

            await AgentTemplate.create({
                "name": tpl.name,
                "description": tpl.description,
                "agent_type": tpl.agent_type,
                "system_prompt": system_prompt,
                "model": tpl.model,
                "flags": canonical_flags,
                "dangerously_skip_permissions": tpl.dangerously_skip_permissions,
                "plan_mode": tpl.plan_mode,
                "is_builtin": True,
            })
