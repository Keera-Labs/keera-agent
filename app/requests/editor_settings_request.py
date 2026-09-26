from typing import Literal

from pydantic import BaseModel, Field

FontFamily = Literal["dank-mono", "fira-code", "monaco", "jetbrains-mono"]

MIN_FONT_SIZE = 11
MAX_FONT_SIZE = 20


class EditorSettingsRequest(BaseModel):
    font_family: FontFamily
    font_size: int = Field(ge=MIN_FONT_SIZE, le=MAX_FONT_SIZE, strict=True)
