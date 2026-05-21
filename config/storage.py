from dataclasses import dataclass, field
from typing import Any, Dict

from fastapi_startkit.storage import LocalDiskConfig


@dataclass
class StorageConfig:
    default: str = "local"

    disks: dict[str, Dict[str, Any]] = field(
        default_factory=lambda: {
            "local": LocalDiskConfig(root="storage"),
        }
    )
