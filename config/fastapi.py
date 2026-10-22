import dataclasses

from fastapi_startkit.environment import env


@dataclasses.dataclass
class FastAPIConfig:
    app_url: str = dataclasses.field(
        default_factory=lambda: env("KEERA_APP_URL", "http://127.0.0.1:4545")
    )
    hook_url: str = dataclasses.field(default_factory=lambda: env("KEERA_HOOK_URL", ""))
    handoff_token: str = dataclasses.field(default_factory=lambda: env("KEERA_HANDOFF_TOKEN", ""))
    handoff_max_bytes: int = dataclasses.field(
        default_factory=lambda: int(env("KEERA_HANDOFF_MAX_BYTES", 64 * 1024 * 1024))
    )
    server_name: str = dataclasses.field(default_factory=lambda: env("KEERA_SERVER_NAME", ""))
    reload: bool = dataclasses.field(default_factory=lambda: env("KEERA_APP_RELOAD", False))
    reload_dirs: list | None = None
    reload_excludes: list = dataclasses.field(
        default_factory=lambda: [
            "tests/*",
            "node_modules/*",
            "storage/*",
        ]
    )
