import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from tests.test_case import TestCase

URL = "/api/settings/remote-control"


class TestRemoteControlSettingController(TestCase):
    """CLAUDE_CONFIG_DIR points the Claude config at a temp dir, so ~/.claude.json is never touched."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.config = Path(self._tmp.name) / ".claude.json"
        self._env = mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": self._tmp.name})
        self._env.start()

    async def asyncTearDown(self):
        self._env.stop()
        self._tmp.cleanup()
        await super().asyncTearDown()

    def write_config(self, data) -> None:
        self.config.write_text(json.dumps(data))

    def read_config(self) -> dict:
        return json.loads(self.config.read_text())

    async def enabled(self) -> bool:
        response = await self.get(URL)
        response.assert_ok()
        return response.json()["data"]["attributes"]["enabled"]

    async def test_show_is_off_when_the_file_is_missing(self):
        self.assertFalse(await self.enabled())
        self.assertFalse(self.config.exists())

    async def test_show_is_off_when_the_key_is_missing(self):
        self.write_config({"numStartups": 3})

        self.assertFalse(await self.enabled())

    async def test_show_reads_the_saved_value(self):
        self.write_config({"remoteControlAtStartup": True})

        self.assertTrue(await self.enabled())

    async def test_update_round_trips_on_and_off(self):
        response = await self.patch(URL, json={"enabled": True})
        response.assert_ok()
        self.assertTrue(response.json()["data"]["attributes"]["enabled"])
        self.assertTrue(await self.enabled())
        self.assertIs(self.read_config()["remoteControlAtStartup"], True)

        response = await self.patch(URL, json={"enabled": False})
        response.assert_ok()
        self.assertFalse(await self.enabled())
        self.assertIs(self.read_config()["remoteControlAtStartup"], False)

    async def test_update_preserves_every_other_key(self):
        original = {
            "numStartups": 42,
            "oauthAccount": {"emailAddress": "someone@example.test"},
            "projects": {"/code/app": {"allowedTools": ["Bash"]}},
        }
        self.write_config(original)

        (await self.patch(URL, json={"enabled": True})).assert_ok()

        self.assertEqual(self.read_config(), {**original, "remoteControlAtStartup": True})

    async def test_update_creates_the_file_when_missing(self):
        (await self.patch(URL, json={"enabled": True})).assert_ok()

        self.assertEqual(self.read_config(), {"remoteControlAtStartup": True})

    async def test_update_leaves_no_temp_files_behind(self):
        self.write_config({"numStartups": 1})

        (await self.patch(URL, json={"enabled": True})).assert_ok()

        self.assertEqual(os.listdir(self._tmp.name), [".claude.json"])

    async def test_update_writes_through_a_symlinked_config(self):
        target = Path(self._tmp.name) / "dotfiles.json"
        target.write_text(json.dumps({"numStartups": 1}))
        self.config.symlink_to(target)

        (await self.patch(URL, json={"enabled": True})).assert_ok()

        self.assertTrue(self.config.is_symlink())
        self.assertEqual(json.loads(target.read_text())["remoteControlAtStartup"], True)

    async def test_invalid_json_is_reported_and_never_overwritten(self):
        self.config.write_text("{not json")

        (await self.get(URL)).assert_status(409)
        response = await self.patch(URL, json={"enabled": True})

        response.assert_status(409)
        self.assertIn("not valid JSON", response.json()["error"])
        self.assertEqual(self.config.read_text(), "{not json")

    async def test_a_non_object_config_is_treated_as_invalid(self):
        self.write_config(["not", "an", "object"])

        response = await self.patch(URL, json={"enabled": True})

        response.assert_status(409)
        self.assertEqual(self.read_config(), ["not", "an", "object"])

    async def test_update_rejects_a_non_boolean(self):
        for value in ("true", 1, None):
            (await self.patch(URL, json={"enabled": value})).assert_status(422)
        self.assertFalse(self.config.exists())
