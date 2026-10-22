import httpx

from app.services.handoff.errors import HandoffTargetFailed, HandoffTargetRejected

HANDOFF_TIMEOUT = httpx.Timeout(300.0, connect=10.0)
PING_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class HandoffClient:
    def __init__(
        self, base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None
    ):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        self.transport = transport

    async def preflight(self, payload: dict) -> dict:
        return await self._data(
            "POST", "/api/handoffs/preflight", json=payload, timeout=PING_TIMEOUT
        )

    async def send(self, payload: dict) -> dict:
        return await self._data("POST", "/api/handoffs", json=payload, timeout=HANDOFF_TIMEOUT)

    async def _data(self, method: str, path: str, **kwargs) -> dict:
        response = await self._request(method, path, **kwargs)
        try:
            data = response.json().get("data")
        except (ValueError, AttributeError) as exc:
            raise HandoffTargetFailed("The target server sent an invalid response.") from exc
        if not isinstance(data, dict):
            raise HandoffTargetFailed("The target server sent an invalid response.")
        return data

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url=self.base_url, headers=self.headers, transport=self.transport
        ) as client:
            try:
                response = await client.request(method, path, **kwargs)
            except httpx.HTTPError as exc:
                raise HandoffTargetFailed("The target server could not be reached.") from exc
        if response.status_code == 401:
            raise HandoffTargetRejected("The target server rejected the handoff token.")
        if 400 <= response.status_code < 500:
            raise HandoffTargetRejected(
                f"The target server refused the handoff: {_reason(response)}"
            )
        if response.status_code >= 500:
            raise HandoffTargetFailed(f"The target server failed the handoff: {_reason(response)}")
        return response


def _reason(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    error = body.get("error") if isinstance(body, dict) else None
    return str(error)[:500] if error else f"HTTP {response.status_code}"
