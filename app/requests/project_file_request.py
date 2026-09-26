from pydantic import BaseModel, Field


class ProjectFileIndexRequest(BaseModel):
    """Query params for listing a directory inside a project."""

    path: str = ""


class ProjectFileContentQuery(BaseModel):
    """Query params identifying a single file inside a project."""

    path: str = Field(min_length=1)


class ProjectFileContentUpdateRequest(BaseModel):
    """Body for saving a file; `etag` is the one returned by the last read."""

    content: str
    etag: str = Field(min_length=1)
