from app.providers.queue_provider import broker
from app.tasks import example_task
from tests.test_case import TestCase


class TestQueue(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await broker.startup()

    async def asyncTearDown(self):
        await broker.shutdown()
        await super().asyncTearDown()

    async def test_broker_is_bound_in_container(self):
        self.assertIs(self.get_application().make("broker"), broker)

    async def test_example_task_dispatches_and_runs(self):
        task = await example_task.kiq("world")
        result = await task.wait_result()

        self.assertFalse(result.is_err)
        self.assertEqual(result.return_value, "processed world")
