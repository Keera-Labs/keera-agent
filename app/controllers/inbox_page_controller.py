from fastapi import Request
from fastapi_startkit.inertia.inertia import Inertia

from app.controllers.home_controller import _shared_props


async def index(request: Request, item: int | None = None):
    return Inertia.render("Inbox", await _shared_props(selected_question_id=item))
