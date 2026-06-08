from fastapi_startkit.jsonapi import JsonResource

from app.models.Agent import Agent


class AgentResource(JsonResource[Agent]):
    pass
