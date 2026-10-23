"""`AsyncArex` mirrors the synchronous behaviour."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fixtures import API_KEY, RUN_ID, STANDARD_HEADERS, Sequence, async_client, response

from arex import (
    ArexTimeoutError,
    AsyncArex,
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
    ResearchRunFailedError,
)


async def test_search_maps_results() -> None:
    handler = Sequence("search.ok")

    async with async_client(handler) as arex:
        result = await arex.search(
            "agents",
            limit=2,
            published_after="2026-08-01T00:00:00Z",
            published_before="2026-09-01T00:00:00Z",
        )

    assert [item.url for item in result.results] == [
        "https://example.org/agents",
        "https://example.org/no-snippet",
    ]
    assert result.results[0].published_at == "2026-09-01T00:00:00.000Z"
    assert result.results[1].published_at is None
    assert not hasattr(result, "credits")
    assert handler.request_json() == {
        "query": "agents",
        "limit": 2,
        "published_after": "2026-08-01T00:00:00Z",
        "published_before": "2026-09-01T00:00:00Z",
    }
    assert handler.read_timeout_ms() == 30000


async def test_contents_maps_like_the_sync_client() -> None:
    contents = Sequence("contents.ok")
    document = await async_client(contents).contents("https://example.org/agents")
    assert document.image_urls == ("https://example.org/a.png",)
    assert document.published_at == "2026-09-01T00:00:00.000Z"
    assert document.image_url == "https://example.org/hero.png"
    assert contents.requests[0].method == "POST"
    assert contents.requests[0].url.path == "/v1/contents"
    assert contents.read_timeout_ms() == 30000


async def test_error_responses_map_to_the_same_classes() -> None:
    with pytest.raises(AuthenticationError) as caught:
        await async_client(Sequence("error.unauthorized")).search("agents")

    assert caught.value.status == 401


async def test_rate_limit_is_retried_then_raised(sleeps: list[float]) -> None:
    handler = Sequence("error.rate-limit")

    with pytest.raises(RateLimitError):
        await async_client(handler, max_retries=1).search("agents")

    assert handler.calls == 2
    assert sleeps == [1.0]


async def test_retry_is_a_new_request_with_only_standard_headers(
    sleeps: list[float],
) -> None:
    handler = Sequence("error.rate-limit", "search.ok")

    result = await async_client(handler).search("agents")

    assert result.results[0].url == "https://example.org/agents"
    assert len(handler.requests) == 2
    for request in handler.requests:
        assert set(request.headers) <= STANDARD_HEADERS
    assert sleeps == [1.0]


async def test_permission_denied_is_not_authentication_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error": {
                    "code": "registration_required",
                    "message": "Registration required.",
                    "retryable": False,
                    "request_id": "req_9f1c2e7a",
                }
            },
        )

    with pytest.raises(PermissionDeniedError) as caught:
        await async_client(handler).search("agents")

    assert caught.value.status == 403
    assert caught.value.code == "registration_required"
    assert caught.value.request_id == "req_9f1c2e7a"


async def test_run_polls_to_completion(sleeps: list[float]) -> None:
    handler = Sequence(
        "research.create",
        "research.get.running",
        "research.get.completed",
    )

    run = await async_client(handler).research.run("agents", mode="deep")

    assert run.status == "completed"
    assert run.result is not None
    assert not hasattr(run, "credits")
    assert sleeps == [2.0, 2.0]


async def test_wait_raises_for_a_failed_run() -> None:
    with pytest.raises(ResearchRunFailedError):
        await async_client(Sequence("research.get.failed")).research.wait(RUN_ID)


async def test_poll_timeout_does_not_cancel(sleeps: list[float]) -> None:
    handler = Sequence("research.get.queued")

    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler).research.wait(RUN_ID, timeout_ms=1)

    assert caught.value.run_id == RUN_ID
    assert [request.method for request in handler.requests] == ["GET"]


async def test_delete_returns_none_when_the_run_is_gone() -> None:
    assert (
        await async_client(Sequence("research.delete.done")).research.delete(RUN_ID)
        is None
    )


async def test_task_cancellation_cancels_the_run_best_effort() -> None:
    seen: list[tuple[str, str]] = []
    cancelled = asyncio.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "POST":
            cancelled.set()
            return response("research.cancel.done")
        return response("research.get.queued")

    arex = async_client(handler)
    task = asyncio.create_task(arex.research.wait(RUN_ID, poll_interval_ms=10))
    await asyncio.sleep(0)
    while not seen:
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.wait_for(cancelled.wait(), timeout=1)

    assert seen[-1] == ("POST", f"/v1/research/{RUN_ID}/cancel")


async def test_cancellation_during_the_first_status_request_cancels_the_run() -> None:
    seen: list[tuple[str, str]] = []
    status_started = asyncio.Event()
    cancelled = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "POST":
            cancelled.set()
            return response("research.cancel.done")
        status_started.set()
        await asyncio.Event().wait()  # held open until the task is cancelled
        return response("research.get.queued")

    arex = async_client(handler)
    task = asyncio.create_task(arex.research.wait(RUN_ID))
    await asyncio.wait_for(status_started.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.wait_for(cancelled.wait(), timeout=1)

    assert seen == [
        ("GET", f"/v1/research/{RUN_ID}"),
        ("POST", f"/v1/research/{RUN_ID}/cancel"),
    ]


async def test_api_key_falls_back_to_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AREX_API_KEY", API_KEY)
    handler = Sequence("search.ok")

    client = AsyncArex(
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    await client.search("agents")

    assert handler.requests[0].headers["authorization"] == f"Bearer {API_KEY}"


async def test_owned_http_client_is_closed_on_exit() -> None:
    client = AsyncArex(API_KEY, base_url="https://example.invalid")

    async with client:
        pass

    assert client._transport.client.is_closed is True
