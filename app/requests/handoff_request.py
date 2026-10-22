from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.constant.complexity import TaskComplexity

SHA = r"^[0-9a-f]{40}([0-9a-f]{24})?$"


class AgentHandoffStoreRequest(BaseModel):
    server_id: int


class HandoffSource(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=500)


class HandoffTask(BaseModel):
    id: int
    title: str | None = None


class HandoffAgent(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    source_agent_id: int
    name: str = Field(min_length=1, max_length=200)
    agent_type: str = "software_engineer"
    provider: Literal["claude"]
    model: str = Field(min_length=1)
    description: str | None = None
    system_prompt: str | None = None
    flags: dict = {}
    dangerously_skip_permissions: bool = True
    plan_mode: bool = False
    complexity: TaskComplexity = TaskComplexity.MEDIUM
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
    worktree: str = Field(min_length=1)
    project: str = Field(min_length=1)
    home: str = Field(min_length=1)
    config_dir: str = Field(min_length=1)


class IncomingHandoffRequest(BaseModel):
    handoff_key: str = Field(pattern=r"^[A-Za-z0-9-]{8,128}$")
    source: HandoffSource
    agent: HandoffAgent
    git: HandoffGit
    transcript: HandoffTranscript
    paths: HandoffPaths
