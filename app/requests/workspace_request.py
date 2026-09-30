import os
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class WorkspaceUpdateRequest(BaseModel):
    """Partial update — only the fields the client sends are applied."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: Optional[str] = None
    description: Optional[str] = None
    claude_config_dir: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value:
            raise ValueError("name must not be empty")
        return value

    @field_validator("description")
    @classmethod
    def blank_description_clears(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("claude_config_dir")
    @classmethod
    def config_dir_is_absolute(cls, value: str | None) -> str | None:
        # Blank clears the override. The dir need not exist yet: Claude creates it.
        if not value:
            return None
        if not os.path.isabs(os.path.expanduser(value)):
            raise ValueError("claude_config_dir must be an absolute path or start with ~")
        return value
