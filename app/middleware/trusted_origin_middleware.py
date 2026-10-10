import logging
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocketClose

logger = logging.getLogger(__name__)

STATE_CHANGING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
LOOPBACK_HOSTNAMES = ("localhost", "127.0.0.1", "[::1]")
POLICY_VIOLATION_CLOSE_CODE = 1008


def origin_of(url: str) -> str:
    parts = urlsplit(url.strip())
    return f"{parts.scheme}://{parts.netloc}".lower()


@dataclass(frozen=True)
class TrustedOrigins:
    app_url: str
    vite_hot_file: Path | None = None
    hosts: frozenset[str] = field(init=False)
    origins: frozenset[str] = field(init=False)

    def __post_init__(self):
        parts = urlsplit(self.app_url)
        hostname = (parts.hostname or "127.0.0.1").lower()
        app_hostname = f"[{hostname}]" if ":" in hostname else hostname
        hostnames = {app_hostname, *LOOPBACK_HOSTNAMES}
        port = parts.port or (443 if parts.scheme == "https" else 80)
        hosts = {f"{name}:{port}" for name in hostnames}
        if parts.port is None:
            hosts |= hostnames
        object.__setattr__(self, "hosts", frozenset(hosts))
        object.__setattr__(self, "origins", frozenset(f"{parts.scheme}://{host}" for host in hosts))

    def allows_host(self, host: str) -> bool:
        return host.lower() in self.hosts

    def allows_origin(self, origin: str) -> bool:
        origin = origin.lower()
        return origin in self.origins or origin == self._vite_origin()

    def _vite_origin(self) -> str | None:
        if self.vite_hot_file is None or not self.vite_hot_file.is_file():
            return None
        return origin_of(self.vite_hot_file.read_text())


class TrustedOriginMiddleware:
    def __init__(self, app: ASGIApp, trusted: TrustedOrigins):
        self.app = app
        self.trusted = trusted

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        rejection = self._rejection_for(scope)
        if rejection is None:
            await self.app(scope, receive, send)
            return

        status_code, message = rejection
        logger.warning(
            "Rejected %s %s: %s", scope.get("method", "WEBSOCKET"), scope["path"], message
        )
        if scope["type"] == "websocket":
            await WebSocketClose(code=POLICY_VIOLATION_CLOSE_CODE)(scope, receive, send)
            return
        await JSONResponse({"error": message}, status_code=status_code)(scope, receive, send)

    def _rejection_for(self, scope: Scope) -> tuple[int, str] | None:
        headers = Headers(scope=scope)
        if not self.trusted.allows_host(headers.get("host", "")):
            return 403, "Request host is not trusted."
        if not self._is_state_changing(scope):
            return None

        origin = headers.get("origin")
        if origin is not None:
            return (
                None
                if self.trusted.allows_origin(origin)
                else (403, "Request origin is not trusted.")
            )
        if self._has_body(headers) and not self._is_json(headers):
            return 415, "Requests without an Origin header must send a JSON body."
        return None

    @staticmethod
    def _is_state_changing(scope: Scope) -> bool:
        return scope["type"] == "websocket" or scope["method"] in STATE_CHANGING_METHODS

    @staticmethod
    def _has_body(headers: Headers) -> bool:
        return headers.get("content-length", "0") != "0" or "transfer-encoding" in headers

    @staticmethod
    def _is_json(headers: Headers) -> bool:
        media_type = headers.get("content-type", "").split(";")[0].strip().lower()
        return media_type == "application/json" or media_type.endswith("+json")
