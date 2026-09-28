from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.constant.complexity import TaskComplexity
from app.constant.task_status import TaskStatus


class TaskStoreRequest(BaseModel):
    """Input model for creating a task."""

    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    title: str = Field(min_length=1)
    body: Optional[str] = None
    assignees: List[str] = []
    priority: str = "medium"
    complexity: Optional[TaskComplexity] = None
    acceptance_criteria: List[str] = []
    testing_methods: List[str] = []
    validation_steps: List[str] = []


class TaskReviewFields(BaseModel):
    """PR, diff and progress details an agent reports while working a task."""

    pr_number: Optional[int] = Field(default=None, ge=1)
    pr_url: Optional[str] = None
    branch: Optional[str] = None
    additions: Optional[int] = Field(default=None, ge=0)
    deletions: Optional[int] = Field(default=None, ge=0)
    review_note: Optional[str] = None
    progress_step: Optional[int] = Field(default=None, ge=0)
    progress_total: Optional[int] = Field(default=None, ge=0)


class TaskUpdateRequest(TaskReviewFields):
    """Partial update model — only the fields supplied by the client are applied."""

    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    title: Optional[str] = None
    body: Optional[str] = None
    assignees: Optional[List[str]] = None
    status: Optional[TaskStatus] = None
    priority: Optional[str] = None
    complexity: Optional[TaskComplexity] = None
    acceptance_criteria: Optional[List[str]] = None
    testing_methods: Optional[List[str]] = None
    validation_steps: Optional[List[str]] = None
