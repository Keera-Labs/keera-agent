from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator


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


class AgentQuestionIndexRequest(BaseModel):
    status: Literal["pending", "answered"] = "pending"


class AgentQuestionAnswerRequest(BaseModel):
    text: str | None = Field(default=None, max_length=4000)
    choices: list[str] = Field(default=[], validate_default=True)

    @field_validator("choices")
    @classmethod
    def requires_an_answer(cls, choices: list[str], info: ValidationInfo) -> list[str]:
        if not choices and not (info.data.get("text") or "").strip():
            raise ValueError("Pick an option or write an answer.")
        return choices
