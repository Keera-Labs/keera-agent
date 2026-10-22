import enum
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ServerKind(str, enum.Enum):
    LOCAL = "local"
    CLOUD = "cloud"


def _http_url(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("base_url must be an http(s) URL")
    return value.rstrip("/")


class ServerStoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    name: str = Field(min_length=1, max_length=120)
    kind: ServerKind = ServerKind.LOCAL
    base_url: str = Field(min_length=1)
    token: str = Field(min_length=1)

    @field_validator("base_url")
    @classmethod
    def _valid_url(cls, value: str) -> str:
        return _http_url(value)


class ServerUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: ServerKind | None = None
    base_url: str | None = Field(default=None, min_length=1)
    token: str | None = Field(default=None, min_length=1)

    @field_validator("base_url")
    @classmethod
    def _valid_url(cls, value: str | None) -> str | None:
        return _http_url(value) if value is not None else value
