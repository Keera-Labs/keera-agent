from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

FontFamily = Literal["dank-mono", "fira-code", "monaco", "jetbrains-mono"]
HidePattern = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

MIN_FONT_SIZE = 11
MAX_FONT_SIZE = 20


class EditorSettingsRequest(BaseModel):
    font_family: FontFamily
    font_size: int = Field(ge=MIN_FONT_SIZE, le=MAX_FONT_SIZE, strict=True)
    hide_hidden: bool = False
    hide_ignored: bool = False
    hidden_patterns: list[HidePattern] = Field(default_factory=list, max_length=50)
