"""BackfillSlugOnAgents Migration."""

import re
from fastapi_startkit.masoniteorm import Migration


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "agent"


class BackfillSlugOnAgents(Migration):
    async def up(self):
        from app.models.Agent import Agent

        agents = await Agent.all()
        seen: dict[int, set[str]] = {}  # project_id -> set of slugs used

        for agent in agents:
            project_id = agent.project_id
            if project_id not in seen:
                seen[project_id] = set()

            base = _slugify(agent.name)
            slug = base
            counter = 2
            while slug in seen[project_id]:
                slug = f"{base}-{counter}"
                counter += 1

            seen[project_id].add(slug)
            agent.slug = slug
            await agent.save()

    async def down(self):
        pass
