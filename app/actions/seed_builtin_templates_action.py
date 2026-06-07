import json as _json

from app.models.AgentTemplate import AgentTemplate
from app.constant.templates import AGENT_TEMPLATES


class SeedBuiltinTemplatesAction:
    """Seed/refresh built-in agent templates from app/constant/templates.py."""

    async def execute(self) -> None:
        from app.utils.system_prompts import default_system_prompt

        for tpl in AGENT_TEMPLATES:
            # Resolve the canonical system prompt via the Jinja2 loader
            system_prompt = default_system_prompt(tpl.agent_type)
            canonical_flags = _json.dumps(tpl.flags)

            existing = await AgentTemplate.where("name", tpl.name).where("is_builtin", True).first()
            if existing:
                # Refresh auto-managed fields so code-side changes propagate
                needs_update = False
                if existing.system_prompt != system_prompt:
                    existing.system_prompt = system_prompt
                    needs_update = True
                if getattr(existing, "flags", None) != canonical_flags:
                    existing.flags = canonical_flags
                    needs_update = True
                if bool(getattr(existing, "dangerously_skip_permissions", True)) != tpl.dangerously_skip_permissions:
                    existing.dangerously_skip_permissions = tpl.dangerously_skip_permissions
                    needs_update = True
                if bool(getattr(existing, "plan_mode", False)) != tpl.plan_mode:
                    existing.plan_mode = tpl.plan_mode
                    needs_update = True
                if needs_update:
                    await existing.save()
                continue

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
