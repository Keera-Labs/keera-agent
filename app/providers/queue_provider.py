from fastapi_startkit.providers import Provider
from taskiq import InMemoryBroker

# Single broker instance shared by the web process (which dispatches jobs with
# ``.kiq``) and the ``queue:work`` worker (which executes them). InMemoryBroker
# runs tasks in the dispatching process and needs no external services, so the
# app stays zero-infra.
#
# UPGRADE PATH — moving to durable, cross-process queuing is the one line below
# plus the KEERA_QUEUE_REDIS_URL env var. Add the ``taskiq-redis`` dependency,
# run a Redis server, and replace this line with:
#
#     from taskiq_redis import RedisStreamBroker
#     from config.queue import QueueConfig
#     broker = RedisStreamBroker(url=QueueConfig().redis_url)
broker = InMemoryBroker()


class QueueProvider(Provider):
    provider_key = "queue"

    def register(self) -> None:
        self.app.bind("broker", broker)

    def boot(self) -> None:
        self.app.fastapi.add_event_handler("startup", broker.startup)
        self.app.fastapi.add_event_handler("shutdown", broker.shutdown)
