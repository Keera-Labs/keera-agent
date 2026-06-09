from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TaskStoreRequest(BaseModel):
    """Input model for creating a task."""
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1)
    body: Optional[str] = None
    assignees: List[str] = []
    priority: str = "medium"
    acceptance_criteria: List[str] = []
    testing_methods: List[str] = []
    validation_steps: List[str] = []


class TaskUpdateRequest(BaseModel):
    """Partial update model — only the fields supplied by the client are applied."""
    model_config = ConfigDict(str_strip_whitespace=True)

    title: Optional[str] = None
    body: Optional[str] = None
    assignees: Optional[List[str]] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    acceptance_criteria: Optional[List[str]] = None
    testing_methods: Optional[List[str]] = None
    validation_steps: Optional[List[str]] = None
