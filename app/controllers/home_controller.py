from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia


async def home(request: Request, project: str | None = None):
    return Inertia.render("Home", {"project": project} if project else {})
