from tests.test_case import TestCase

URL = "/api/global-settings"


class TestGlobalSettingsController(TestCase):
    """Tests for PATCH /api/global-settings validation.

    HTTP writes commit on their own connection, so we don't use
    DatabaseTransaction here.  Each test exercises a discrete input/output
    relationship that is independent of prior state.
    """

    # --- GET ---

    async def test_get_returns_settings(self):
        response = await self.get(URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("max_agents_per_project", data)

    # --- PATCH: valid values ---

    async def test_patch_sets_valid_max_agents(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["max_agents_per_project"], 5)

    async def test_patch_accepts_boundary_value_1(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["max_agents_per_project"], 1)

    async def test_patch_accepts_boundary_value_100(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 100})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["max_agents_per_project"], 100)

    # --- PATCH: invalid values (must return 422) ---

    async def test_patch_rejects_zero(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 0})
        self.assertEqual(response.status_code, 422)

    async def test_patch_rejects_negative(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": -5})
        self.assertEqual(response.status_code, 422)

    async def test_patch_rejects_above_100(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 101})
        self.assertEqual(response.status_code, 422)

    async def test_patch_rejects_very_large_number(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 99999})
        self.assertEqual(response.status_code, 422)

    async def test_patch_rejects_non_integer_string(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": "ten"})
        self.assertEqual(response.status_code, 422)

    async def test_patch_rejects_float(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 5.5})
        self.assertEqual(response.status_code, 422)

    async def test_patch_422_returns_error_message(self):
        response = await self.client.patch(URL, json={"max_agents_per_project": 200})
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertIn("error", body)
        self.assertIn("100", body["error"])
