from fastapi_startkit.inertia.inertia import Inertia

from app.models.Project import Project


async def index(project: str):
    proj = await Project.where("slug", project).first()
    return Inertia.render(
        "Configurations",
        {"project": project, "project_id": proj.id if proj else None},
    )
