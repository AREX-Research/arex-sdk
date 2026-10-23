"""Loader for the wire fixtures shared with the TypeScript test suite."""

from __future__ import annotations

import json
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

import httpx

from arex import Arex, AsyncArex

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures"

API_KEY = "sk_arex_" + "a" * 32
RUN_ID = "0f7c3b3e-2d3a-4b7e-9a1c-6f0d2b8c4e5a"
# Everything httpx and the client may send; any other header is a contract change.
STANDARD_HEADERS = frozenset(
    {
        "host",
        "accept",
        "accept-encoding",
        "authorization",
        "connection",
        "content-length",
        "content-type",
        "user-agent",
    }
)


def load(name: str) -> dict[str, Any]:
    """The raw `{status, headers, body}` record of one fixture."""
    payload: dict[str, Any] = json.loads(
        (FIXTURE_DIR / f"{name}.json").read_text(encoding="utf-8")
    )
    return payload


def body(name: str) -> Any:
    return load(name)["body"]


def response(name: str) -> httpx.Response:
    """The fixture as an `httpx.Response`."""
    record = load(name)
    raw = record["body"]
    if raw is None:
        content = b""
    elif isinstance(raw, str):
        content = raw.encode("utf-8")
    else:
        content = json.dumps(raw).encode("utf-8")
    return httpx.Response(
        record["status"], headers=dict(record["headers"]), content=content
    )


class Sequence:
    """Serves the named fixtures in order, repeating the last one, and records
    every request so tests can assert on paths, bodies and timeouts."""

    def __init__(self, *names: str) -> None:
        if not names:
            raise ValueError("at least one fixture name is required")
        self.names = list(names)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        index = min(len(self.requests), len(self.names) - 1)
        self.requests.append(request)
        return response(self.names[index])

    @property
    def calls(self) -> int:
        return len(self.requests)

    def request_json(self, index: int = 0) -> Any:
        return json.loads(self.requests[index].content)

    def timeout(self, index: int = 0) -> dict[str, float | None]:
        extensions: dict[str, Any] = self.requests[index].extensions
        timeout: dict[str, float | None] = extensions["timeout"]
        return timeout

    def read_timeout_ms(self, index: int = 0) -> float:
        read = self.timeout(index)["read"]
        assert read is not None
        return read * 1000


Handler = Callable[[httpx.Request], httpx.Response]
AsyncHandler = Callable[[httpx.Request], Coroutine[None, None, httpx.Response]]


def sync_client(handler: Handler, **kwargs: Any) -> Arex:
    return Arex(
        API_KEY,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        **kwargs,
    )


def async_client(handler: Handler | AsyncHandler, **kwargs: Any) -> AsyncArex:
    return AsyncArex(
        API_KEY,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        **kwargs,
    )
