from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GitPathsRequest(BaseModel):
    """Stage/unstage body: explicit repo-relative `paths`, or `all` for every change."""

    paths: list[str] = []
    all: bool = False

    @model_validator(mode="after")
    def paths_or_all(self) -> "GitPathsRequest":
        if not self.all and not self.paths:
            raise ValueError("Provide paths or set all to true")
        return self

    def selected_paths(self) -> list[str] | None:
        return None if self.all else self.paths


class GitWorktreeQuery(BaseModel):
    """`worktree` is a path from GET /git/worktrees; omitted means the project's checkout."""

    worktree: Optional[str] = None


class GitCommitIndexQuery(GitWorktreeQuery):
    limit: int = Field(default=20, ge=1, le=100)


class GitDiffQuery(GitWorktreeQuery):
    # Validated by the diff service so a missing path is a 422 JSON error like a bad one.
    path: str = ""
    staged: bool = False


class GitCommitStoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    message: str = Field(min_length=1)


class PullRequestStoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: Optional[str] = None
    body: Optional[str] = None
    base: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
    draft: bool = False
