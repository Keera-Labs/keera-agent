from pathlib import PurePosixPath, PureWindowsPath

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _escapes_project_root(path: str) -> bool:
    return (
        PurePosixPath(path).is_absolute()
        or PureWindowsPath(path).is_absolute()
        or path.startswith("~")
        or ".." in PurePosixPath(path.replace("\\", "/")).parts
    )


class ProjectWorktreeFileUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    paths: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("paths")
    @classmethod
    def paths_stay_inside_project(cls, paths: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(path for path in paths if path))
        for path in cleaned:
            if "\x00" in path or _escapes_project_root(path):
                raise ValueError(f"'{path}' must be a path relative to the project root")
        return cleaned
