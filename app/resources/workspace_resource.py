from fastapi_startkit.jsonapi import JsonResource

from app.models.Workspace import Workspace


class WorkspaceResource(JsonResource[Workspace]):
    type = "workspaces"

    def to_attributes(self) -> dict:
        return {
            "name": self.model.name,
            "description": self.model.description,
            "claude_config_dir": self.model.claude_config_dir,
        }
