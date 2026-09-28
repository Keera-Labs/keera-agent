from app.models.GlobalSettings import GlobalSettings
from tests.test_case import TestCase

URL = "/api/settings/appearance"


def _attrs(response) -> dict:
    return response.json()["data"]["attributes"]


class TestAppearanceSettingsController(TestCase):
    """HTTP writes commit on their own connection, so the row is removed by hand."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await GlobalSettings.where("key", "appearance").delete()

    async def asyncTearDown(self):
        await GlobalSettings.where("key", "appearance").delete()
        await super().asyncTearDown()

    async def test_show_returns_default_when_nothing_saved(self):
        response = await self.get(URL)

        response.assert_ok()
        self.assertEqual(response.json()["data"]["type"], "appearance_settings")
        self.assertEqual(_attrs(response), {"ui_font_size": 13})

    async def test_update_persists_and_show_returns_saved_value(self):
        response = await self.patch(URL, json={"ui_font_size": 16})

        response.assert_ok()
        self.assertEqual(_attrs(response), {"ui_font_size": 16})
        self.assertEqual(_attrs(await self.get(URL)), {"ui_font_size": 16})

    async def test_update_overwrites_the_previous_value(self):
        await self.patch(URL, json={"ui_font_size": 11})
        await self.patch(URL, json={"ui_font_size": 18})

        self.assertEqual(await GlobalSettings.where("key", "appearance").count(), 1)
        self.assertEqual(_attrs(await self.get(URL))["ui_font_size"], 18)

    async def test_update_rejects_sizes_outside_11_to_18(self):
        for size in (10, 19, "14", None):
            response = await self.patch(URL, json={"ui_font_size": size})
            response.assert_status(422)
        self.assertIsNone(await GlobalSettings.where("key", "appearance").first())

    async def test_update_rejects_missing_field(self):
        response = await self.patch(URL, json={})
        response.assert_status(422)
