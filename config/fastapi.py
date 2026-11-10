import dataclasses

from fastapi_startkit.environment import env


@dataclasses.dataclass
class FastAPIConfig:
    app_url: str = env("KEERA_APP_URL", "http://127.0.0.1:4545")
    hook_url: str = env("KEERA_HOOK_URL", "")
    reload: bool = env("KEERA_APP_RELOAD", False)
    reload_dirs: list | None = None
    reload_excludes: list = dataclasses.field(
        default_factory=lambda: [
            "tests/*",
            "node_modules/*",
            "storage/*",
        ]
    )
