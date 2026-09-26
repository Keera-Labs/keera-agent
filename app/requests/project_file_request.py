from pydantic import BaseModel


class ProjectFileIndexRequest(BaseModel):
    """Query params for listing a directory inside a project."""

    path: str = ""
