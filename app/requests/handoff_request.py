import posixpath
from typing import Literal, TypeVar

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi_startkit import Config
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.constant.complexity import TaskComplexity
from app.services.handoff.errors import HandoffTooLarge

SHA = r"^[0-9a-f]{40}([0-9a-f]{24})?$"
TOO_BROAD_PATHS = {"/", "/home", "/users", "/usr", "/tmp", "/var", "/etc", "/opt", "/srv"}

Body = TypeVar("Body", bound=BaseModel)


class AgentHandoffStoreRequest(BaseModel):
    server_id: int


class HandoffSource(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=500)


class HandoffTask(BaseModel):
    id: int
    title: str | None = None


class HandoffAgentSettings(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    provider: Literal["claude"]
    model: str = Field(min_length=1)
    complexity: TaskComplexity = TaskComplexity.MEDIUM


class HandoffAgent(HandoffAgentSettings):
    source_agent_id: int
    name: str = Field(min_length=1, max_length=200)
    agent_type: str = "software_engineer"
    description: str | None = None
    system_prompt: str | None = None
    system_prompt_is_default: bool = False
    flags: dict = {}
    dangerously_skip_permissions: bool = True
    plan_mode: bool = False
    task: HandoffTask | None = None


class HandoffGit(BaseModel):
    remote_url: str = Field(min_length=1)
    branch: str = Field(pattern=r"^handoff/[A-Za-z0-9._-]+$", max_length=200)
    source_branch: str | None = None
    base_sha: str = Field(pattern=SHA)
    head_sha: str = Field(pattern=SHA)
    wip: bool = False


class HandoffFile(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    encoding: Literal["text", "base64"] = "text"
    content: str


class HandoffTranscript(BaseModel):
    session_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,127}$")
    files: list[HandoffFile] = Field(min_length=1)


class HandoffPaths(BaseModel):
    worktree: str
    project: str
    home: str
    config_dir: str

    @field_validator("worktree", "project", "home", "config_dir")
    @classmethod
    def _specific_absolute_path(cls, value: str) -> str:
        normalized = posixpath.normpath(value.strip())
        if not posixpath.isabs(normalized) or normalized.lower() in TOO_BROAD_PATHS:
            raise ValueError("must be a specific absolute path")
        if len(normalized) < 4:
            raise ValueError("must be a specific absolute path")
        return normalized


class HandoffPreflightRequest(BaseModel):
    remote_url: str = Field(min_length=1)
    agent: HandoffAgentSettings


class IncomingHandoffRequest(BaseModel):
    handoff_key: str = Field(pattern=r"^[A-Za-z0-9-]{8,128}$")
    source: HandoffSource
    agent: HandoffAgent
    git: HandoffGit
    transcript: HandoffTranscript
    paths: HandoffPaths


async def read_bounded_body(request: Request, model: type[Body]) -> Body:
    limit = int(Config.get("fastapi.handoff_max_bytes") or 0)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HandoffTooLarge(f"The handoff payload exceeds {limit} bytes.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HandoffTooLarge(f"The handoff payload exceeds {limit} bytes.")
        chunks.append(chunk)
    try:
        return model.model_validate_json(b"".join(chunks))
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False)) from exc
