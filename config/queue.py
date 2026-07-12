import dataclasses

from fastapi_startkit.environment import env


@dataclasses.dataclass
class QueueConfig:
    """Task queue configuration.

    The app ships with an in-memory broker that needs no external services, so
    ``redis_url`` is unused by default. It is read only when the broker in
    ``app/providers/queue_provider.py`` is swapped for a Redis-backed broker,
    keeping that upgrade a one-line code change plus this env var.
    """

    redis_url: str = dataclasses.field(
        default_factory=lambda: env("KEERA_QUEUE_REDIS_URL", "redis://localhost:6379")
    )
