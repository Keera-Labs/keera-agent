from fastapi_startkit.jsonapi import JsonResource


class RemoteControlSettingResource(JsonResource[dict]):
    """A singleton settings document, so it has a fixed id rather than a row id."""

    type = "remote_control_settings"

    def __init__(self, settings: dict) -> None:
        super().__init__(settings)
        self.id = "remote_control"

    def to_attributes(self) -> dict:
        return dict(self.model)
