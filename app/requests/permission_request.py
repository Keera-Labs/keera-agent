from typing import List

from pydantic import BaseModel, ConfigDict, field_validator


class PermissionRequest(BaseModel):
    """Input model for allow/deny tool permissions.

    Empty and blank entries are dropped so callers no longer filter lists by hand.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    allow: List[str] = []
    deny: List[str] = []

    @field_validator("allow", "deny")
    @classmethod
    def _drop_blank(cls, values: List[str]) -> List[str]:
        return [v for v in values if isinstance(v, str) and v.strip()]
