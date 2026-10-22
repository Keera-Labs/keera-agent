from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    choices: list[str] = []
    text: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def requires_an_answer(self) -> "AgentQuestionAnswerRequest":
        if not self.choices and not (self.text or "").strip():
            raise ValueError("Pick an option or write an answer.")
        return self
