from fastapi_startkit.jsonapi import JsonResource


class EditorSettingsResource(JsonResource[dict]):
    """A singleton settings document, so it has a fixed id rather than a row id."""

    type = "editor_settings"

    def __init__(self, settings: dict) -> None:
        super().__init__(settings)
        self.id = "editor"

    def to_attributes(self) -> dict:
        return dict(self.model)
