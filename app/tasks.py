from app.providers.queue_provider import broker


@broker.task
async def example_task(name: str) -> str:
    """Example background job.

    Dispatch it (fire-and-forget) from a controller or action with::

        from app.tasks import example_task

        task = await example_task.kiq("world")
        result = await task.wait_result()  # -> "processed world"
    """
    return f"processed {name}"
