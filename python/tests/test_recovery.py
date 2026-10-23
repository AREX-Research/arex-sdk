"""Deadlines and Retry-After edge cases, for the synchronous and asynchronous
clients alike."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from conftest import FakeClock
from fixtures import RUN_ID, Sequence, async_client, response, sync_client

from arex import (
    ArexTimeoutError,
    InvalidRequestError,
    RateLimitError,
    ServiceUnavailableError,
    api_error_from_response,
)

RATE_LIMIT_BODY = {
    "error": {
        "code": "rate_limit_exceeded",
        "message": "Slow down",
        "retryable": True,
        "request_id": "req_retry",
    }
}


def rate_limited(retry_after: str | None) -> httpx.Response:
    headers = {} if retry_after is None else {"Retry-After": retry_after}
    return httpx.Response(429, headers=headers, json=RATE_LIMIT_BODY)


# --- configuration and per-call timeout validation ---------------------------

BAD_TIMEOUTS: list[Any] = [0, -1, True, 1.5, float("inf"), float("nan"), "30", 10**400]


@pytest.mark.parametrize("value", BAD_TIMEOUTS)
def test_constructor_rejects_bad_timeout(value: Any) -> None:
    with pytest.raises(ValueError, match="timeout_ms"):
        sync_client(Sequence("search.ok"), timeout_ms=value)
    with pytest.raises(ValueError, match="timeout_ms"):
        async_client(Sequence("search.ok"), timeout_ms=value)


@pytest.mark.parametrize("value", [-1, True, 1.5, "2", None])
def test_constructor_rejects_bad_max_retries(value: Any) -> None:
    with pytest.raises(ValueError, match="max_retries"):
        sync_client(Sequence("search.ok"), max_retries=value)
    with pytest.raises(ValueError, match="max_retries"):
        async_client(Sequence("search.ok"), max_retries=value)


def test_zero_max_retries_disables_retries(sleeps: list[float]) -> None:
    handler = Sequence("error.rate-limit")

    with pytest.raises(RateLimitError):
        sync_client(handler, max_retries=0).search("agents")

    assert handler.calls == 1


@pytest.mark.parametrize("value", BAD_TIMEOUTS)
def test_per_call_timeout_is_validated_before_any_request(value: Any) -> None:
    handler = Sequence("search.ok", "contents.ok", "research.create")
    arex_client = sync_client(handler)
    calls: list[Callable[[], Any]] = [
        lambda: arex_client.search("agents", timeout_ms=value),
        lambda: arex_client.contents("https://example.org/", timeout_ms=value),
        lambda: arex_client.research.create("agents", timeout_ms=value),
        lambda: arex_client.research.get(RUN_ID, timeout_ms=value),
        lambda: arex_client.research.cancel(RUN_ID, timeout_ms=value),
        lambda: arex_client.research.delete(RUN_ID, timeout_ms=value),
        lambda: arex_client.research.wait(RUN_ID, timeout_ms=value),
        lambda: arex_client.research.run("agents", timeout_ms=value),
    ]
    for call in calls:
        with pytest.raises(InvalidRequestError) as caught:
            call()
        assert caught.value.param == "timeout_ms"
    assert handler.calls == 0


@pytest.mark.parametrize("value", BAD_TIMEOUTS)
async def test_async_per_call_timeout_is_validated_before_any_request(
    value: Any,
) -> None:
    handler = Sequence("search.ok")
    client = async_client(handler)
    calls: list[Callable[[], Awaitable[Any]]] = [
        lambda: client.search("agents", timeout_ms=value),
        lambda: client.contents("https://example.org/", timeout_ms=value),
        lambda: client.research.create("agents", timeout_ms=value),
        lambda: client.research.get(RUN_ID, timeout_ms=value),
        lambda: client.research.wait(RUN_ID, timeout_ms=value),
        lambda: client.research.run("agents", timeout_ms=value),
    ]
    for call in calls:
        with pytest.raises(InvalidRequestError) as caught:
            await call()
        assert caught.value.param == "timeout_ms"
    assert handler.calls == 0


# --- one request budget across retries ---------------------------------------


def test_retry_attempts_get_only_the_remaining_budget(clock: FakeClock) -> None:
    statuses = iter([rate_limited("1"), rate_limited("1"), None])
    seen: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.extensions["timeout"]["read"])
        clock.advance(0.5)
        failure = next(statuses)
        return failure if failure is not None else response("search.ok")

    sync_client(handler, max_retries=2).search("agents", timeout_ms=10_000)

    assert clock.sleeps == [1.0, 1.0]
    assert seen == [10.0, 8.5, 7.0]


@pytest.mark.parametrize("timeout_ms", [500, 1000])
def test_retry_delay_is_bounded_by_the_request_deadline(
    timeout_ms: int, clock: FakeClock
) -> None:
    handler = Sequence("error.rate-limit")  # Retry-After: 1s

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).search("agents", timeout_ms=timeout_ms)

    assert caught.value.phase == "request"
    assert handler.calls == 1
    assert clock.now == timeout_ms / 1000


async def test_async_retry_attempts_get_only_the_remaining_budget(
    clock: FakeClock,
) -> None:
    statuses = iter([rate_limited("1"), None])
    seen: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.extensions["timeout"]["read"])
        clock.advance(0.5)
        failure = next(statuses)
        return failure if failure is not None else response("search.ok")

    await async_client(handler).search("agents", timeout_ms=10_000)

    assert clock.sleeps == [1.0]
    assert seen == [10.0, 8.5]


async def test_async_retry_delay_is_bounded_by_the_request_deadline(
    clock: FakeClock,
) -> None:
    handler = Sequence("error.rate-limit")

    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler).search("agents", timeout_ms=1000)

    assert caught.value.phase == "request"
    assert handler.calls == 1
    assert clock.now == 1.0


async def test_async_deadline_cancels_a_hung_request() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.Event().wait()
        return response("search.ok")

    started = time.monotonic()
    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler).search("agents", timeout_ms=100)

    assert caught.value.phase == "request"
    assert caught.value.timeout_ms == 100
    assert time.monotonic() - started < 2


async def test_async_deadline_cancels_a_retry_sleep() -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return rate_limited("0.2")

    started = time.monotonic()
    with pytest.raises(ArexTimeoutError):
        await async_client(handler, max_retries=5).search("agents", timeout_ms=500)

    assert time.monotonic() - started < 2
    assert attempts <= 3


async def test_async_caller_cancellation_is_not_a_timeout() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.Event().wait()
        return response("search.ok")

    task = asyncio.create_task(async_client(handler).search("agents"))
    await asyncio.sleep(0.01)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


# --- poll deadline wins over late outcomes -----------------------------------


def test_late_terminal_status_is_a_poll_timeout(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(6)
        return response("research.get.completed")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).research.wait(RUN_ID, timeout_ms=5000)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID
    assert caught.value.timeout_ms == 5000


def test_late_rate_limit_is_a_poll_timeout(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(6)
        return rate_limited("1")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler, max_retries=0).research.wait(RUN_ID, timeout_ms=5000)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID


def test_status_retry_delay_past_the_poll_deadline_is_a_poll_timeout(
    clock: FakeClock,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return rate_limited("10")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).research.wait(RUN_ID, timeout_ms=5000)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID
    assert clock.now == 5.0


def test_status_retry_sleep_inside_the_budget_still_polls(clock: FakeClock) -> None:
    replies = iter([rate_limited("1"), response("research.get.completed")])

    run = sync_client(lambda request: next(replies)).research.wait(
        RUN_ID, timeout_ms=5000
    )

    assert run.status == "completed"
    assert clock.sleeps == [1.0]


def test_rate_limit_with_poll_time_left_keeps_its_type(clock: FakeClock) -> None:
    handler = Sequence("error.rate-limit")

    with pytest.raises(RateLimitError) as caught:
        sync_client(handler, max_retries=0).research.wait(RUN_ID)

    assert caught.value.run_id == RUN_ID


def test_run_names_the_run_on_a_late_outcome(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return response("research.create")
        clock.advance(10)
        return response("research.get.completed")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).research.run("agents", timeout_ms=5000)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID


async def test_async_late_terminal_status_is_a_poll_timeout(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(6)
        return response("research.get.completed")

    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler).research.wait(RUN_ID, timeout_ms=5000)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID


async def test_async_late_rate_limit_is_a_poll_timeout(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(6)
        return rate_limited("1")

    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler, max_retries=0).research.wait(
            RUN_ID, timeout_ms=5000
        )

    assert caught.value.phase == "poll"


async def test_async_status_retry_delay_past_the_poll_deadline_is_a_poll_timeout(
    clock: FakeClock,
) -> None:
    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(lambda request: rate_limited("10")).research.wait(
            RUN_ID, timeout_ms=5000
        )

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID
    assert clock.now == 5.0


async def test_async_hung_status_request_is_cut_at_the_poll_deadline() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.Event().wait()
        return response("research.get.queued")

    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler).research.wait(RUN_ID, timeout_ms=100)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID


# --- Retry-After parsing -----------------------------------------------------


def retry_after_ms(value: str) -> int | None:
    error = api_error_from_response(429, RATE_LIMIT_BODY, {"Retry-After": value})
    return error.retry_after_ms


def test_delta_seconds_are_converted() -> None:
    assert retry_after_ms("3") == 3000
    assert retry_after_ms(" 1.5 ") == 1500


def test_naive_http_date_is_read_as_utc() -> None:
    # RFC 5322 "-0000" marks a date whose zone is unknown; parsers return it naive.
    assert retry_after_ms("Fri, 01 Jan 2100 00:00:00 -0000") == retry_after_ms(
        "Fri, 01 Jan 2100 00:00:00 GMT"
    )
    assert retry_after_ms("Fri, 01 Jan 2100 00:00:00 -0000") is not None


def test_past_http_date_means_no_wait() -> None:
    assert retry_after_ms("Wed, 21 Oct 2015 07:28:00 GMT") == 0


@pytest.mark.parametrize("value", ["9" * 400, "99999999999999999999.5"])
def test_huge_delay_is_clamped_not_overflowed(value: str) -> None:
    wait = retry_after_ms(value)
    assert wait is not None
    assert wait >= 2**31 - 1


def test_far_future_http_date_does_not_overflow() -> None:
    wait = retry_after_ms("Fri, 31 Dec 9999 23:59:59 GMT")
    assert wait is not None
    assert wait >= 2**31 - 1


@pytest.mark.parametrize(
    "value", ["", "soon", "-5", "nan", "inf", "1e3", "0x10", "1_0", "١٢", "Fri, 99 Foo"]
)
def test_malformed_retry_after_is_ignored(value: str) -> None:
    assert retry_after_ms(value) is None


def test_huge_retry_after_expires_the_request_without_retrying(
    clock: FakeClock,
) -> None:
    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(lambda request: rate_limited("9" * 400)).search("agents")

    assert caught.value.phase == "request"
    assert clock.now == 30.0


@pytest.mark.parametrize(
    ("fixture", "retries", "error_type"),
    [
        ("error.rate-limit", 0, RateLimitError),
        ("error.outstanding-run-limit", 2, RateLimitError),
        ("error.temporarily-unavailable", 2, ServiceUnavailableError),
    ],
)
def test_poll_preserves_unretried_errors_before_its_deadline(
    fixture: str, retries: int, error_type: type[Exception], clock: FakeClock
) -> None:
    reply = response(fixture)
    reply.headers["Retry-After"] = "600"
    with pytest.raises(error_type):
        sync_client(lambda request: reply, max_retries=retries).research.wait(
            RUN_ID, timeout_ms=5000
        )
    assert clock.now == 0


@pytest.mark.parametrize(
    ("fixture", "retries", "error_type"),
    [
        ("error.rate-limit", 0, RateLimitError),
        ("error.outstanding-run-limit", 2, RateLimitError),
        ("error.temporarily-unavailable", 2, ServiceUnavailableError),
    ],
)
async def test_async_poll_preserves_unretried_errors_before_its_deadline(
    fixture: str, retries: int, error_type: type[Exception], clock: FakeClock
) -> None:
    reply = response(fixture)
    reply.headers["Retry-After"] = "600"
    with pytest.raises(error_type):
        await async_client(lambda request: reply, max_retries=retries).research.wait(
            RUN_ID, timeout_ms=5000
        )
    assert clock.now == 0


def test_late_search_response_is_a_request_timeout(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(6)
        return response("search.ok")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).search("agents", timeout_ms=5000)
    assert caught.value.phase == "request"


async def test_async_late_search_response_is_a_request_timeout(
    clock: FakeClock,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(6)
        return response("search.ok")

    with pytest.raises(ArexTimeoutError) as caught:
        await async_client(handler).search("agents", timeout_ms=5000)
    assert caught.value.phase == "request"
