from pydantic import BaseModel


class ProjectVisibilityUpdateRequest(BaseModel):
    hidden: bool
