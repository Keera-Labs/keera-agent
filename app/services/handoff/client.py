import httpx

from app.services.handoff.errors import HandoffTargetFailed

HANDOFF_TIMEOUT = httpx.Timeout(300.0, connect=10.0)
PING_TIMEOUT = httpx.Timeout(10.0)


class HandoffClient:
    def __init__(
        self, base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None
    ):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        self.transport = transport

    async def ping(self) -> dict:
        response = await self._request("GET", "/api/handoff", timeout=PING_TIMEOUT)
        return response.json().get("data", {})

    async def send(self, payload: dict) -> dict:
        response = await self._request(
            "POST", "/api/handoffs", json=payload, timeout=HANDOFF_TIMEOUT
        )
        return response.json().get("data", {})

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url=self.base_url, headers=self.headers, transport=self.transport
        ) as client:
            try:
                response = await client.request(method, path, **kwargs)
            except httpx.HTTPError as exc:
                raise HandoffTargetFailed("The target server could not be reached.") from exc
        if response.status_code == 401:
            raise HandoffTargetFailed("The target server rejected the handoff token.")
        if response.status_code >= 400:
            raise HandoffTargetFailed(f"The target server refused the handoff: {_reason(response)}")
        return response


def _reason(response: httpx.Response) -> str:
    try:
        error = response.json().get("error")
    except ValueError:
        error = None
    return str(error)[:300] if error else f"HTTP {response.status_code}"
