import dataclasses

from fastapi_startkit.environment import env


@dataclasses.dataclass
class FastAPIConfig:
    app_url: str = dataclasses.field(default_factory=lambda: env("KEERA_APP_URL", "http://127.0.0.1:4545"))
    reload: bool = dataclasses.field(default_factory=lambda: env("KEERA_APP_RELOAD", False))
    reload_dirs: list | None = None
    reload_excludes: list = dataclasses.field(
        default_factory=lambda: [
            "tests/*",
            "node_modules/*",
            "storage/*",
        ]
    )
