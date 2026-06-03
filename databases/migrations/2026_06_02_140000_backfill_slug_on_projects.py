"""BackfillSlugOnProjects Migration."""

import re

from fastapi_startkit.masoniteorm import Migration

from app.models.Project import Project


def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))


class BackfillSlugOnProjects(Migration):
    async def up(self):
        projects = await Project.all()
        for project in projects:
            if not project.slug:
                await Project.where("id", project.id).update({"slug": _slugify(project.name)})

    async def down(self):
        pass
