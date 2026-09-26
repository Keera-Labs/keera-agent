from pydantic import BaseModel, Field, field_validator


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

    @field_validator("content")
    @classmethod
    def content_must_be_encodable(cls, value: str) -> str:
        # JSON can carry lone surrogates ("\ud800") that have no UTF-8 encoding.
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as e:
            raise ValueError("content is not valid UTF-8 text") from e
        return value
