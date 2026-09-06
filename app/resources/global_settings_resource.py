from fastapi_startkit.jsonapi import JsonResource


class GlobalSettingsResource(JsonResource[dict]):
    """Serialize global settings without changing the established API envelope."""

    def __init__(self, settings: dict):
        super().__init__(settings)

    def serialize(self) -> dict:
        return self.model
