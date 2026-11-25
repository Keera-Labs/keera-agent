from typing import Literal

from pydantic import BaseModel


class ProjectTaskRulesUpdateRequest(BaseModel):
    task_rules: Literal["warn", "enforce"]
