import json

from app.models.GlobalSettings import GlobalSettings
from tests.test_case import TestCase

URL = "/api/settings/editor"


def _attrs(response) -> dict:
    return response.json()["data"]["attributes"]


class TestEditorSettingsController(TestCase):
    """HTTP writes commit on their own connection, so the row is removed by hand."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await GlobalSettings.where("key", "editor").delete()

    async def asyncTearDown(self):
        await GlobalSettings.where("key", "editor").delete()
        await super().asyncTearDown()

    async def test_show_returns_defaults_when_nothing_saved(self):
        response = await self.get(URL)

        response.assert_ok()
        self.assertEqual(response.json()["data"]["type"], "editor_settings")
        self.assertEqual(
            _attrs(response), {"font_family": "dank-mono", "font_size": 13, "customized": False}
        )

    async def test_update_persists_and_show_returns_saved_values(self):
        response = await self.patch(URL, json={"font_family": "jetbrains-mono", "font_size": 16})

        response.assert_ok()
        self.assertEqual(
            _attrs(response), {"font_family": "jetbrains-mono", "font_size": 16, "customized": True}
        )
        self.assertEqual(
            _attrs(await self.get(URL)),
            {"font_family": "jetbrains-mono", "font_size": 16, "customized": True},
        )

    async def test_update_overwrites_the_previous_value(self):
        await self.patch(URL, json={"font_family": "monaco", "font_size": 11})
        await self.patch(URL, json={"font_family": "fira-code", "font_size": 20})

        self.assertEqual(await GlobalSettings.where("key", "editor").count(), 1)
        self.assertEqual(_attrs(await self.get(URL))["font_family"], "fira-code")

    async def test_update_rejects_unknown_font_family(self):
        response = await self.patch(URL, json={"font_family": "comic-sans", "font_size": 13})

        response.assert_status(422)
        self.assertIsNone(await GlobalSettings.where("key", "editor").first())

    async def test_update_rejects_sizes_outside_11_to_20(self):
        for size in (10, 21, "14"):
            response = await self.patch(URL, json={"font_family": "fira-code", "font_size": size})
            response.assert_status(422)

    async def test_show_falls_back_to_defaults_for_a_corrupt_row(self):
        await GlobalSettings.create({"key": "editor", "value": json.dumps({"font_size": 99})})

        self.assertEqual(
            _attrs(await self.get(URL)),
            {"font_family": "dank-mono", "font_size": 13, "customized": False},
        )
