import datetime
import itertools
import logging

from fastapi_startkit.environment import env

from app.providers.queue_provider import broker

logger = logging.getLogger(__name__)

# Cron expression for the periodic heartbeat, overridable via env. Default fires
# once a minute (the finest granularity cron supports).
HEARTBEAT_CRON = env("KEERA_QUEUE_HEARTBEAT_CRON", "* * * * *")

# Monotonic sequence for the heartbeat task. Under the in-memory broker tasks
# run in the dispatching process, so this counter increments per dispatch and
# makes successive heartbeats distinguishable.
_heartbeat_sequence = itertools.count(1)


@broker.task(schedule=[{"cron": HEARTBEAT_CRON}])
async def heartbeat() -> dict:
    """Queue liveness probe for exercising TaskIQ end to end.

    Distinct from ``app/heartbeat.py`` (the PM task-status loop): this is a
    background job you dispatch through the broker to confirm the queue runs.

    Dispatch it on demand::

        from app.tasks import heartbeat

        task = await heartbeat.kiq()
        payload = (await task.wait_result()).return_value
        # -> {"status": "alive", "sequence": 1, "timestamp": "..."}

    Or run it periodically with ``uv run python artisan queue:schedule`` — the
    ``schedule`` label above fires it on the ``KEERA_QUEUE_HEARTBEAT_CRON`` cron.
    """
    payload = {
        "status": "alive",
        "sequence": next(_heartbeat_sequence),
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
    }
    logger.info("queue heartbeat %s", payload)
    return payload
