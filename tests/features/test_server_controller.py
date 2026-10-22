from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Server import Server
from tests.test_case import TestCase


def _attributes(response) -> dict:
    return response.json()["data"]["attributes"]


class TestServerController(TestCase, DatabaseTransaction):
    async def _create(self, **overrides):
        payload = {
            "name": "Cloud box",
            "kind": "cloud",
            "base_url": "https://keera.example.com/",
            "token": "s3cret-token",
            **overrides,
        }
        return await self.post("/api/servers", json=payload)

    async def test_store_creates_a_server_without_exposing_the_token(self):
        response = await self._create()

        response.assert_ok()
        attributes = _attributes(response)
        self.assertEqual(attributes["name"], "Cloud box")
        self.assertEqual(attributes["kind"], "cloud")
        self.assertEqual(attributes["base_url"], "https://keera.example.com")
        self.assertTrue(attributes["has_token"])
        self.assertNotIn("token", attributes)
        self.assertNotIn("s3cret-token", response.text)

    async def test_store_defaults_to_a_local_server(self):
        response = await self.post(
            "/api/servers",
            json={"name": "Laptop", "base_url": "http://127.0.0.1:4545", "token": "t"},
        )
        self.assertEqual(_attributes(response)["kind"], "local")

    async def test_store_rejects_invalid_input(self):
        (await self._create(kind="mainframe")).assert_status(422)
        (await self._create(base_url="ftp://example.com")).assert_status(422)
        (await self._create(name="  ")).assert_status(422)
        (await self._create(token="")).assert_status(422)

    async def test_index_lists_servers_without_tokens(self):
        created = _attributes(await self._create(name="Index box"))

        response = await self.get("/api/servers")

        response.assert_ok()
        rows = [row for row in response.json()["data"] if str(row["id"]) == str(created["id"])]
        self.assertEqual(len(rows), 1)
        self.assertNotIn("token", rows[0]["attributes"])

    async def test_update_changes_fields_and_keeps_the_token_when_omitted(self):
        server_id = _attributes(await self._create(name="Before"))["id"]

        response = await self.patch(
            f"/api/servers/{server_id}", json={"name": "After", "kind": "local"}
        )

        response.assert_ok()
        self.assertEqual(_attributes(response)["name"], "After")
        self.assertEqual(_attributes(response)["kind"], "local")
        self.assertEqual((await Server.find(server_id)).token, "s3cret-token")

    async def test_update_replaces_the_token(self):
        server_id = _attributes(await self._create())["id"]

        await self.patch(f"/api/servers/{server_id}", json={"token": "rotated"})

        self.assertEqual((await Server.find(server_id)).token, "rotated")

    async def test_update_returns_404_for_a_missing_server(self):
        (await self.patch("/api/servers/999999", json={"name": "x"})).assert_status(404)

    async def test_destroy_removes_the_server(self):
        server_id = _attributes(await self._create())["id"]

        (await self.delete(f"/api/servers/{server_id}")).assert_status(204)

        self.assertIsNone(await Server.find(server_id))
        (await self.delete(f"/api/servers/{server_id}")).assert_status(404)
