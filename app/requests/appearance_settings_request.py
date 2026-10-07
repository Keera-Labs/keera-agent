from pydantic import BaseModel, Field

MIN_FONT_SIZE = 11
MAX_FONT_SIZE = 18


class AppearanceSettingsRequest(BaseModel):
    ui_font_size: int = Field(ge=MIN_FONT_SIZE, le=MAX_FONT_SIZE, strict=True)
