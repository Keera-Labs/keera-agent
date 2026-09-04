from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia

from app.controllers.home_controller import _shared_props


async def settings(request: Request):
    return Inertia.render("settings/Index", await _shared_props())
