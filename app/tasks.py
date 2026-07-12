import datetime
import itertools

from app.providers.queue_provider import broker

# Monotonic sequence for the heartbeat task. Under the in-memory broker tasks
# run in the dispatching process, so this counter increments per dispatch and
# makes successive heartbeats distinguishable.
_heartbeat_sequence = itertools.count(1)


@broker.task
async def example_task(name: str) -> str:
    """Example background job.

    Dispatch it (fire-and-forget) from a controller or action with::

        from app.tasks import example_task

        task = await example_task.kiq("world")
        result = await task.wait_result()  # -> "processed world"
    """
    return f"processed {name}"


@broker.task
async def heartbeat() -> dict:
    """Queue liveness probe for exercising TaskIQ end to end.

    Distinct from ``app/heartbeat.py`` (the PM task-status loop): this is a
    background job you dispatch through the broker to confirm the queue runs.

        from app.tasks import heartbeat

        task = await heartbeat.kiq()
        payload = (await task.wait_result()).return_value
        # -> {"status": "alive", "sequence": 1, "timestamp": "..."}
    """
    return {
        "status": "alive",
        "sequence": next(_heartbeat_sequence),
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
    }
