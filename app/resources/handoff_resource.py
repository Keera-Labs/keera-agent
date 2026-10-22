from fastapi_startkit.jsonapi import JsonResource

from app.models.Handoff import Handoff


class HandoffResource(JsonResource[Handoff]):
    pass
