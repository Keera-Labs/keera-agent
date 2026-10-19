from fastapi_startkit.jsonapi import JsonResource

from app.models.Project import Project


class ProjectResource(JsonResource[Project]):
    type = "projects"

    def to_attributes(self) -> dict:
        return {
            "name": self.model.name,
            "slug": self.model.slug,
            "last_opened_at": self.model.last_opened_at,
            "hidden": self.model.last_opened_at is None,
        }
