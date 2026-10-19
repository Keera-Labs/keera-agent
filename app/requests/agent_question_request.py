from pydantic import BaseModel, ConfigDict, Field


class AskedOption(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str
    description: str | None = None


class AskedQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    question: str = Field(min_length=1)
    header: str | None = None
    options: list[AskedOption] = []
    multi_select: bool = Field(default=False, alias="multiSelect")
