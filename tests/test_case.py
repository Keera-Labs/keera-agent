from fastapi_startkit import Config
from fastapi_startkit.fastapi.testing import HttpTestCase


class TestCase(HttpTestCase):
    def get_application(self):
        from bootstrap.application import app

        return app

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.client.base_url = Config.get("fastapi.app_url")
