from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia


async def index(request: Request):
    return Inertia.render("Home", {})


async def project(request: Request, project: str):
    return Inertia.render("Home", {"project": project})
