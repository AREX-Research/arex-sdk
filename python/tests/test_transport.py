"""Retry policy, timeout derivation and configuration."""

from __future__ import annotations

import os

import httpx
import pytest
from fixtures import API_KEY, RUN_ID, STANDARD_HEADERS, Sequence, sync_client

from arex import (
    Arex,
    ArexNetworkError,
    ArexTimeoutError,
    RateLimitError,
    ServiceUnavailableError,
)


def test_rate_limit_is_retried_using_retry_after(sleeps: list[float]) -> None:
    handler = Sequence("error.rate-limit", "search.ok")

    response = sync_client(handler).search("agents")

    assert response.results[0].url == "https://example.org/agents"
    assert handler.calls == 2
    assert sleeps == [1.0]


def test_retry_is_a_new_request_with_only_standard_headers(
    sleeps: list[float],
) -> None:
    handler = Sequence("error.rate-limit", "search.ok")

    result = sync_client(handler).search("agents")

    assert result.results[0].url == "https://example.org/agents"
    assert len(handler.requests) == 2
    for request in handler.requests:
        assert set(request.headers) <= STANDARD_HEADERS
    assert sleeps == [1.0]


def test_rate_limit_retries_stop_at_max_retries(sleeps: list[float]) -> None:
    handler = Sequence("error.rate-limit")

    with pytest.raises(RateLimitError):
        sync_client(handler, max_retries=2).search("agents")

    assert handler.calls == 3
    assert sleeps == [1.0, 1.0]


def test_outstanding_run_limit_is_never_retried(sleeps: list[float]) -> None:
    handler = Sequence("error.outstanding-run-limit")

    with pytest.raises(RateLimitError):
        sync_client(handler).research.create("agents")

    assert handler.calls == 1
    assert sleeps == []


def test_service_unavailable_is_not_retried_by_default(sleeps: list[float]) -> None:
    handler = Sequence("error.temporarily-unavailable")

    with pytest.raises(ServiceUnavailableError):
        sync_client(handler).search("agents")

    assert handler.calls == 1
    assert sleeps == []


def test_service_unavailable_is_retried_when_opted_in(sleeps: list[float]) -> None:
    handler = Sequence("error.temporarily-unavailable", "search.ok")

    sync_client(handler, retry_unavailable=True).search("agents")

    assert handler.calls == 2
    assert sleeps == [5.0]


def test_internal_error_is_not_retried_even_when_opted_in(sleeps: list[float]) -> None:
    handler = Sequence("error.internal")

    with pytest.raises(ServiceUnavailableError):
        sync_client(handler, retry_unavailable=True).search("agents")

    assert handler.calls == 1
    assert sleeps == []


def test_search_uses_its_fixed_timeout() -> None:
    search = Sequence("search.ok")
    sync_client(search).search("agents")
    assert search.read_timeout_ms() == 30000


@pytest.mark.parametrize(
    ("kwargs", "expected_ms"),
    [
        ({}, 30000),
        ({"tier": "flex"}, 70000),
        ({"livecrawl": True}, 30000),
        ({"livecrawl": True, "tier": "flex"}, 100000),
        ({"livecrawl": True, "livecrawl_timeout_ms": 5000}, 15000),
    ],
)
def test_contents_timeout_follows_the_server_deadline(
    kwargs: dict[str, object], expected_ms: int
) -> None:
    handler = Sequence("contents.ok")

    sync_client(handler).contents("https://example.org/agents", **kwargs)  # type: ignore[arg-type]

    assert handler.read_timeout_ms() == expected_ms


def test_research_lifecycle_calls_use_the_fixed_timeout() -> None:
    handler = Sequence("research.get.queued")

    sync_client(handler).research.get(RUN_ID)

    assert handler.read_timeout_ms() == 30000


def test_client_timeout_overrides_the_per_call_default() -> None:
    handler = Sequence("search.ok")

    sync_client(handler, timeout_ms=1234).search("agents")

    assert handler.read_timeout_ms() == 1234


def test_per_call_timeout_overrides_the_client_timeout() -> None:
    handler = Sequence("search.ok")

    sync_client(handler, timeout_ms=1234).search("agents", timeout_ms=4321)

    assert handler.read_timeout_ms() == 4321


def test_request_timeout_becomes_an_arex_timeout_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).search("agents")

    assert caught.value.phase == "request"
    assert caught.value.timeout_ms == 30000


def test_connection_failure_becomes_a_network_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(ArexNetworkError) as caught:
        sync_client(handler).search("agents")

    assert caught.value.code == "request_failed"


def test_non_json_success_body_becomes_a_network_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "text/plain"},
            content=b"not json",
        )

    with pytest.raises(ArexNetworkError) as caught:
        sync_client(handler).search("agents")

    assert caught.value.code == "invalid_response"


def test_api_key_falls_back_to_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AREX_API_KEY", API_KEY)
    handler = Sequence("search.ok")

    client = Arex(http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.search("agents")

    assert handler.requests[0].headers["authorization"] == f"Bearer {API_KEY}"


def test_missing_api_key_is_a_value_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AREX_API_KEY", raising=False)

    with pytest.raises(ValueError):
        Arex()


def test_injected_http_client_is_not_closed_by_the_sdk() -> None:
    http_client = httpx.Client(transport=httpx.MockTransport(Sequence("search.ok")))

    with Arex(API_KEY, http_client=http_client):
        pass

    assert http_client.is_closed is False
    http_client.close()


def test_owned_http_client_is_closed_on_exit() -> None:
    client = Arex(API_KEY, base_url="https://example.invalid")

    with client:
        pass

    assert client._transport.client.is_closed is True


def test_base_url_is_applied_to_requests() -> None:
    handler = Sequence("search.ok")
    client = Arex(
        API_KEY,
        base_url="https://api.example.test/",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    client.search("agents")

    assert str(handler.requests[0].url) == "https://api.example.test/v1/search"


def test_environment_is_not_consulted_when_a_key_is_passed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AREX_API_KEY", "sk_arex_" + "z" * 32)
    handler = Sequence("search.ok")

    sync_client(handler).search("agents")

    assert handler.requests[0].headers["authorization"] == f"Bearer {API_KEY}"
    assert os.environ["AREX_API_KEY"] != API_KEY
