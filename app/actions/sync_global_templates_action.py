from app.actions.seed_builtin_templates_action import global_template_fields
from app.constant.templates import AGENT_TEMPLATES
from app.models.AgentTemplate import AgentTemplate


class SyncGlobalTemplatesAction:
    """Re-pull code defaults into the GLOBAL built-in template rows, OVERWRITING
    any manual edits. Code (app/constant/templates.py + app/prompts) is the
    source of truth for built-ins; this is the explicit, opt-in counterpart to
    the insert-if-missing boot seeder.

    Only global built-ins are touched. User-created global templates and any
    project-scoped overrides are left untouched — project overrides keep
    shadowing their global until reset from the project.
    """

    async def execute(self) -> int:
        count = 0
        for tpl in AGENT_TEMPLATES:
            fields = global_template_fields(tpl)
            existing = await (
                AgentTemplate.where("name", tpl.name)
                .where("is_builtin", True)
                .where_null("project_id")
                .first()
            )
            if existing:
                await AgentTemplate.where("id", existing.id).update(fields)
            else:
                await AgentTemplate.create(fields)
            count += 1
        return count
