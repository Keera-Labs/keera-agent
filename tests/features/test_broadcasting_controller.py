"""Feature tests for the /broadcasting page and /api/broadcasting/ping endpoint."""
from unittest.mock import AsyncMock, patch

from tests.test_case import TestCase


class TestBroadcastingPage(TestCase):
    """Tests for the GET /broadcasting Inertia page."""

    async def test_broadcasting_page_renders_inertia_component(self):
        """The page must render the Broadcasting Inertia component (Inertia XHR)."""
        response = await self.get("/broadcasting", headers={"X-Inertia": "true"})
        response.assert_ok().assert_json(lambda j: j.where("component", "Broadcasting").etc())


class TestBroadcastingPingEndpoint(TestCase):
    """Tests for POST /api/broadcasting/ping."""

    async def test_ping_returns_ok(self):
        with patch(
            "app.controllers.broadcasting_controller.broadcast",
            new_callable=AsyncMock,
        ):
            response = await self.post(
                "/api/broadcasting/ping",
                json={"message": "hello"},
            )
        response.assert_ok().assert_json(lambda j: (
            j.where("status", "ok")
             .where("message", "hello")
             .etc()
        ))

    async def test_ping_uses_default_message_when_omitted(self):
        with patch(
            "app.controllers.broadcasting_controller.broadcast",
            new_callable=AsyncMock,
        ):
            response = await self.post("/api/broadcasting/ping", json={})
        response.assert_ok().assert_json(lambda j: j.where("message", "ping").etc())

    async def test_ping_broadcasts_ping_event(self):
        """broadcast() must be awaited with a PingEvent carrying the message."""
        from app.events.ping_event import PingEvent

        captured = []

        async def mock_broadcast(event):
            captured.append(event)

        with patch(
            "app.controllers.broadcasting_controller.broadcast",
            side_effect=mock_broadcast,
        ):
            await self.post(
                "/api/broadcasting/ping",
                json={"message": "test-payload"},
            )

        self.assertEqual(len(captured), 1)
        event = captured[0]
        self.assertIsInstance(event, PingEvent)
        self.assertEqual(event.message, "test-payload")
        # Event targets the right channel
        self.assertEqual(event.broadcast_on()[0].name, "broadcasting-poc")
        # Event serialises the message
        self.assertEqual(event.broadcast_with()["message"], "test-payload")

    async def test_ping_strips_whitespace_from_message(self):
        with patch(
            "app.controllers.broadcasting_controller.broadcast",
            new_callable=AsyncMock,
        ):
            response = await self.post(
                "/api/broadcasting/ping",
                json={"message": "  padded  "},
            )
        response.assert_json(lambda j: j.where("message", "padded").etc())
