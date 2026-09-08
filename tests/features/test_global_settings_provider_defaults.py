from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.GlobalSettings import GlobalSettings
from tests.test_case import TestCase


class TestGlobalSettingsProviderDefaults(TestCase, DatabaseTransaction):
    async def test_get_returns_provider_and_complexity_defaults(self):
        response = await self.get("/api/global-settings")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["default_provider"], "codex")
        self.assertEqual(
            response.json()["complexity_models"],
            {"easy": "gpt-5.6-luna", "medium": "gpt-5.6-terra", "hard": "gpt-5.6-sol"},
        )

    async def test_patch_persists_and_echoes_provider_defaults(self):
        payload = {
            "provider_models": {
                "codex": ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
                "claude": ["claude-opus-5", "claude-sonnet-5", "claude-fable-5"],
            },
            "default_provider": "claude",
            "complexity_models": {
                "easy": "claude-sonnet-5",
                "medium": "claude-opus-5",
                "hard": "claude-fable-5",
            },
        }

        response = await self.patch("/api/global-settings", json=payload)

        self.assertEqual(response.status_code, 200)
        for key, value in payload.items():
            self.assertEqual(response.json()[key], value)

        reloaded = await self.get("/api/global-settings")
        for key, value in payload.items():
            self.assertEqual(reloaded.json()[key], value)

    async def test_patch_rejects_unknown_provider(self):
        response = await self.patch("/api/global-settings", json={"default_provider": "other"})

        self.assertEqual(response.status_code, 422)

    async def test_patch_rejects_model_not_configured_for_default_provider(self):
        response = await self.patch(
            "/api/global-settings",
            json={
                "default_provider": "codex",
                "complexity_models": {
                    "easy": "claude-sonnet-5",
                    "medium": "gpt-5.6-terra",
                    "hard": "gpt-5.6-sol",
                },
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("configured for codex", response.json()["error"])

    async def test_saved_values_reload_from_global_settings_store(self):
        await GlobalSettings.create({"key": "default_provider", "value": "claude"})
        await GlobalSettings.create(
            {
                "key": "complexity_models",
                "value": '{"easy":"claude-sonnet-5","medium":"claude-opus-5","hard":"claude-fable-5"}',
            }
        )

        response = await self.get("/api/global-settings")

        self.assertEqual(response.json()["default_provider"], "claude")
        self.assertEqual(response.json()["complexity_models"]["hard"], "claude-fable-5")
