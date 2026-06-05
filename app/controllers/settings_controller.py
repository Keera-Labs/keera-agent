from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia


async def settings(request: Request):
    return Inertia.render("Settings", {})
