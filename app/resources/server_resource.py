from fastapi_startkit.jsonapi import JsonResource

from app.models.Server import Server


class ServerResource(JsonResource[Server]):
    def to_attributes(self) -> dict:
        data = self.model.serialize()
        token = data.pop("token", None)
        data["has_token"] = bool(token)
        return data
