"""Feature tests for the robust /mcp POST handler.

Regression coverage for the recurring 500 (JSONDecodeError: Extra data) that
occurred when a client posted two JSON-RPC objects concatenated in one body
instead of a JSON array batch. The handler must parse leniently and never 500.
"""

import json

from tests.test_case import TestCase

INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}


def _init(req_id):
    return {"jsonrpc": "2.0", "id": req_id, "method": "initialize", "params": {}}


class TestMcpPostHandler(TestCase):
    async def _post_raw(self, body: str):
        return await self.post("/mcp", content=body, headers={"Content-Type": "application/json"})

    async def test_single_request_returns_single_response(self):
        response = await self._post_raw(json.dumps(_init(1)))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, dict)
        self.assertEqual(data["id"], 1)
        self.assertEqual(data["jsonrpc"], "2.0")
        self.assertIn("result", data)

    async def test_concatenated_objects_do_not_500(self):
        """The core bug: {...}{...} in one body used to raise Extra data → 500."""
        body = json.dumps(_init(1)) + json.dumps(_init(2))
        response = await self._post_raw(body)
        self.assertNotEqual(response.status_code, 500)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        ids = sorted(item["id"] for item in data)
        self.assertEqual(ids, [1, 2])

    async def test_newline_separated_objects_do_not_500(self):
        body = json.dumps(_init(1)) + "\n" + json.dumps(_init(2))
        response = await self._post_raw(body)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual(sorted(item["id"] for item in data), [1, 2])

    async def test_indented_concatenated_objects_do_not_500(self):
        """Reproduces the 'line N column 6' indented shape seen in logs."""
        body = json.dumps(_init(1), indent=2) + "\n" + json.dumps(_init(2), indent=2)
        response = await self._post_raw(body)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual(sorted(item["id"] for item in data), [1, 2])

    async def test_json_array_batch_returns_array(self):
        body = json.dumps([_init(1), _init(2)])
        response = await self._post_raw(body)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual(sorted(item["id"] for item in data), [1, 2])

    async def test_notification_mixed_with_request(self):
        """A notification (no id) yields no response; the request still answers."""
        notification = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        body = json.dumps(notification) + json.dumps(_init(7))
        response = await self._post_raw(body)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual([item["id"] for item in data], [7])

    async def test_single_notification_returns_202(self):
        notification = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        response = await self._post_raw(json.dumps(notification))
        self.assertEqual(response.status_code, 202)

    async def test_garbage_body_does_not_500(self):
        response = await self._post_raw("this is not json at all {{{")
        self.assertNotEqual(response.status_code, 500)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("error", data)
        self.assertEqual(data["error"]["code"], -32700)

    async def test_empty_body_does_not_500(self):
        response = await self._post_raw("")
        self.assertNotEqual(response.status_code, 500)
        self.assertEqual(response.status_code, 200)
        self.assertIn("error", response.json())
