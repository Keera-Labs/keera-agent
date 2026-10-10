from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.constant.command_kind import CommandKind


class CommandStoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    label: str = Field(min_length=1)
    command: str = Field(min_length=1)
    description: str = ""
    category: str = "General"
    shortcut: str = ""
    kind: CommandKind = CommandKind.RUN


class CommandUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    label: Optional[str] = Field(default=None, min_length=1)
    command: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None
    category: Optional[str] = None
    shortcut: Optional[str] = None
    kind: Optional[CommandKind] = None


class CommandRunStoreRequest(BaseModel):
    worktree: Optional[str] = None


class ProjectCommandRunStoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    command: str = Field(min_length=1)
    worktree: Optional[str] = None
