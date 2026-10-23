"""Research lifecycle calls and the `wait`/`run` pollers."""

from __future__ import annotations

import httpx
import pytest
from conftest import FakeClock
from fixtures import RUN_ID, Sequence, async_client, body, response, sync_client

from arex import (
    ArexNetworkError,
    ArexTimeoutError,
    InvalidRequestError,
    ResearchRunCancelledError,
    ResearchRunFailedError,
)


def test_create_returns_the_queued_run() -> None:
    handler = Sequence("research.create")

    run = sync_client(handler).research.create("agent evaluation", mode="deep")

    assert run.id == RUN_ID
    assert run.status == "queued"
    assert run.mode == "deep"
    assert run.requested_mode == "auto"
    assert run.created_at == "2026-09-21T09:00:00.000Z"
    assert not hasattr(run, "credits")
    assert handler.request_json() == {"query": "agent evaluation", "mode": "deep"}
    assert handler.requests[0].url.path == "/v1/research"

    assert "prefer" not in handler.requests[0].headers


def test_create_returns_synchronously_completed_run() -> None:
    handler = Sequence("research.get.completed")

    run = sync_client(handler).research.create("agent evaluation", mode="fast")

    assert run.status == "completed"
    assert run.result is not None
    assert run.result.answer == "Agents are evaluated by ..."
    assert run.message is None
    assert "prefer" not in handler.requests[0].headers


@pytest.mark.parametrize("async_mode", [False, True])
async def test_create_sends_prefer_respond_async_when_detached(
    async_mode: bool,
) -> None:
    handler = Sequence("research.create")
    if async_mode:
        await async_client(handler).research.create(
            "agents", detach=True, timeout_ms=5_000
        )
    else:
        sync_client(handler).research.create("agents", detach=True, timeout_ms=5_000)

    assert handler.requests[0].headers.get("prefer") == "respond-async"


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize(
    ("timeout_ms", "expected"),
    [
        (1_000, "respond-async"),
        (2_500, "respond-async"),
        (2_999, "respond-async"),
        (3_000, "wait=1"),
        (10_000, "wait=8"),
        (21_999, "wait=19"),
        (22_000, None),
        (30_000, None),
    ],
)
async def test_create_sends_prefer_when_timeout_under_22s(
    async_mode: bool, timeout_ms: int, expected: str | None
) -> None:
    handler = Sequence("research.create")
    if async_mode:
        await async_client(handler).research.create("agents", timeout_ms=timeout_ms)
    else:
        sync_client(handler).research.create("agents", timeout_ms=timeout_ms)

    assert handler.requests[0].headers.get("prefer") == expected


@pytest.mark.parametrize("async_mode", [False, True])
async def test_create_retry_replaces_prefer_wait_with_respond_async(
    async_mode: bool, sleeps: list[float]
) -> None:
    handler = Sequence("error.rate-limit", "research.create")
    if async_mode:
        await async_client(handler).research.create("agents", timeout_ms=10_000)
    else:
        sync_client(handler).research.create("agents", timeout_ms=10_000)

    assert handler.calls == 2
    assert handler.requests[0].headers.get("prefer") == "wait=8"
    assert handler.requests[1].headers.get("prefer") == "respond-async"


def test_get_returns_the_running_run() -> None:
    run = sync_client(Sequence("research.get.running")).research.get(RUN_ID)

    assert run.status == "running"
    assert run.started_at == "2026-09-21T09:00:03.000Z"
    assert not hasattr(run, "credits")


@pytest.mark.parametrize("async_mode", [False, True])
async def test_research_response_preserves_new_modes_and_failure_codes(
    async_mode: bool,
) -> None:
    payload = body("research.get.failed")
    payload["mode"] = "future-mode"
    payload["requested_mode"] = "future-requested-mode"
    payload["error"]["code"] = "future-failure"
    payload["future_field"] = {"ignored": True}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    if async_mode:
        run = await async_client(handler).research.get(RUN_ID)
    else:
        run = sync_client(handler).research.get(RUN_ID)

    assert str(run.mode) == "future-mode"
    assert str(run.requested_mode) == "future-requested-mode"
    assert run.error is not None
    assert str(run.error.code) == "future-failure"
    assert run.error.retryable is True


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("field", ["status", "mode", "requested_mode", "code"])
@pytest.mark.parametrize("value", [None, "", 42, False, [], {}])
async def test_research_response_rejects_empty_or_mistyped_strings(
    async_mode: bool, field: str, value: object
) -> None:
    payload = body("research.get.failed")
    target = payload["error"] if field == "code" else payload
    target[field] = value

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    with pytest.raises(ArexNetworkError) as caught:
        if async_mode:
            await async_client(handler).research.get(RUN_ID)
        else:
            sync_client(handler).research.get(RUN_ID)
    assert caught.value.code == "invalid_response"


@pytest.mark.parametrize("async_mode", [False, True])
async def test_get_preserves_unknown_status_and_message(async_mode: bool) -> None:
    payload = body("research.get.running")
    payload["status"] = "future-status"
    payload["message"] = "Research is still in progress."
    payload.pop("result", None)
    payload.pop("error", None)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    if async_mode:
        run = await async_client(handler).research.get(RUN_ID)
    else:
        run = sync_client(handler).research.get(RUN_ID)

    assert str(run.status) == "future-status"
    assert run.message == "Research is still in progress."
    assert run.result is None
    assert run.error is None


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("method", ["wait", "run"])
async def test_unknown_status_keeps_polling_with_response_delays(
    async_mode: bool, method: str, sleeps: list[float]
) -> None:
    payload = body("research.get.running")
    payload["status"] = "future-status"
    payload.pop("result", None)
    payload.pop("error", None)
    requests: list[httpx.Request] = []
    polls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal polls
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(202, json=payload)
        polls += 1
        if polls == 3:
            return response("research.get.completed")
        headers = {"Retry-After": "0.5"} if polls == 1 else {}
        return httpx.Response(200, json=payload, headers=headers)

    client = async_client(handler) if async_mode else sync_client(handler)
    result = getattr(client.research, method)(
        RUN_ID if method == "wait" else "agents",
        poll_interval_ms=250,
        timeout_ms=5000,
    )
    run = await result if async_mode else result

    assert run.status == "completed"
    assert run.result is not None
    assert run.result.answer == "Agents are evaluated by ..."
    assert sleeps == ([0.25, 0.5, 0.25] if method == "run" else [0.5, 0.25])
    assert [request.extensions["timeout"]["read"] for request in requests] == (
        [5.0, 4.75, 4.25, 4.0] if method == "run" else [5.0, 4.5, 4.25]
    )


def test_run_polls_to_completion(sleeps: list[float]) -> None:
    handler = Sequence(
        "research.create",
        "research.get.queued",
        "research.get.running",
        "research.get.completed",
    )

    run = sync_client(handler).research.run("agent evaluation", mode="deep")

    assert run.status == "completed"
    assert run.result is not None
    assert run.result.answer == "Agents are evaluated by ..."
    assert [source.url for source in run.result.sources] == [
        "https://example.org/agents"
    ]
    assert not hasattr(run, "credits")
    assert handler.calls == 4
    assert sleeps == [2.0, 2.0, 2.0]


@pytest.mark.parametrize("async_mode", [False, True])
async def test_run_short_circuits_on_terminal_create(
    async_mode: bool, sleeps: list[float]
) -> None:
    completed_handler = Sequence("research.get.completed")
    if async_mode:
        run = await async_client(completed_handler).research.run(
            "agent evaluation", mode="fast"
        )
    else:
        run = sync_client(completed_handler).research.run(
            "agent evaluation", mode="fast"
        )
    assert run.status == "completed"
    assert run.result is not None
    assert completed_handler.calls == 1
    assert sleeps == []

    failed_handler = Sequence("research.get.failed")
    with pytest.raises(ResearchRunFailedError):
        if async_mode:
            await async_client(failed_handler).research.run("agent evaluation")
        else:
            sync_client(failed_handler).research.run("agent evaluation")
    assert failed_handler.calls == 1

    cancelled_handler = Sequence("research.get.cancelled")
    with pytest.raises(ResearchRunCancelledError):
        if async_mode:
            await async_client(cancelled_handler).research.run("agent evaluation")
        else:
            sync_client(cancelled_handler).research.run("agent evaluation")
    assert cancelled_handler.calls == 1


@pytest.mark.parametrize("async_mode", [False, True])
async def test_run_caps_create_timeout_and_sends_prefer_wait(
    async_mode: bool,
) -> None:
    short_handler = Sequence("research.get.completed")
    if async_mode:
        await async_client(short_handler).research.run("agents", timeout_ms=8_000)
    else:
        sync_client(short_handler).research.run("agents", timeout_ms=8_000)
    assert short_handler.read_timeout_ms(0) == 8_000
    assert short_handler.requests[0].headers.get("prefer") == "wait=6"

    long_handler = Sequence("research.get.completed")
    if async_mode:
        await async_client(long_handler).research.run("agents", timeout_ms=60_000)
    else:
        sync_client(long_handler).research.run("agents", timeout_ms=60_000)
    assert long_handler.read_timeout_ms(0) == 30_000
    assert "prefer" not in long_handler.requests[0].headers


def test_run_honours_a_custom_poll_interval(sleeps: list[float]) -> None:
    handler = Sequence("research.create", "research.get.completed")

    sync_client(handler).research.run("agents", poll_interval_ms=250)

    assert sleeps == [0.25]


def test_run_auto_mode_gets_the_deep_poll_budget(sleeps: list[float]) -> None:
    """The server resolved `auto` to fast here, but the caller could not know
    that up front, so the budget must still cover a deep run."""
    handler = Sequence("research.create.fast", "research.get.queued")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).research.run("agents", mode="auto")

    assert caught.value.timeout_ms == 180_000
    assert sum(sleeps) == pytest.approx(180.0)


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("method", ["get", "wait"])
@pytest.mark.parametrize(
    ("status", "field", "present"),
    [
        ("completed", "result", False),
        ("completed", "result", True),
        ("failed", "error", False),
        ("failed", "error", True),
    ],
)
async def test_terminal_run_requires_its_payload(
    async_mode: bool, method: str, status: str, field: str, present: bool
) -> None:
    payload = body(f"research.get.{status}")
    if present:
        payload[field] = None
    else:
        del payload[field]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = async_client(handler) if async_mode else sync_client(handler)
    with pytest.raises(ArexNetworkError) as caught:
        result = getattr(client.research, method)(RUN_ID)
        if async_mode:
            await result
    assert caught.value.code == "invalid_response"
    if method == "wait":
        assert caught.value.run_id == RUN_ID


@pytest.mark.parametrize(
    "status", ["queued", "running", "completed", "failed", "cancelled", "future-status"]
)
def test_research_payloads_belong_only_to_the_matching_state(status: str) -> None:
    fixture_status = "running" if status == "future-status" else status
    payload = body(f"research.get.{fixture_status}")
    payload["status"] = status
    payload["result"] = body("research.get.completed")["result"]
    payload["error"] = body("research.get.failed")["error"]
    payload["message"] = "Poll GET /v1/research/id every 2s."
    run = sync_client(lambda request: httpx.Response(200, json=payload)).research.get(
        RUN_ID
    )
    assert (run.result is not None) == (status == "completed")
    assert (run.error is not None) == (status == "failed")
    assert (run.message is not None) == (
        status in ("queued", "running", "future-status")
    )


def test_wait_returns_the_completed_run(sleeps: list[float]) -> None:
    handler = Sequence("research.get.running", "research.get.completed")

    run = sync_client(handler).research.wait(RUN_ID)

    assert run.status == "completed"
    assert run.completed_at == "2026-09-21T09:01:40.000Z"
    assert not hasattr(run, "credits")
    assert handler.calls == 2


def test_wait_raises_for_a_failed_run() -> None:
    with pytest.raises(ResearchRunFailedError) as caught:
        sync_client(Sequence("research.get.failed")).research.wait(RUN_ID)

    run = caught.value.run
    assert run.status == "failed"
    assert run.error is not None
    assert run.error.code == "timeout"
    assert run.error.retryable is True


def test_wait_raises_for_a_cancelled_run() -> None:
    with pytest.raises(ResearchRunCancelledError) as caught:
        sync_client(Sequence("research.get.cancelled")).research.wait(RUN_ID)

    assert caught.value.run.status == "cancelled"


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("method", ["wait", "run"])
@pytest.mark.parametrize("status", ["queued", "future-status"])
async def test_poll_timeout_reports_the_run_and_does_not_cancel(
    async_mode: bool, method: str, status: str, sleeps: list[float]
) -> None:
    payload = body("research.get.queued")
    payload["status"] = status
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=payload, headers={"Retry-After": "0.5"})

    client = async_client(handler) if async_mode else sync_client(handler)
    with pytest.raises(ArexTimeoutError) as caught:
        result = getattr(client.research, method)(
            RUN_ID if method == "wait" else "agents",
            poll_interval_ms=250,
            timeout_ms=750,
        )
        if async_mode:
            await result

    error = caught.value
    assert error.phase == "poll"
    assert error.timeout_ms == 750
    assert error.run_id == RUN_ID
    assert sleeps == ([0.25, 0.5] if method == "run" else [0.5, 0.25])
    assert [request.method for request in requests] == (
        ["POST", "GET"] if method == "run" else ["GET", "GET"]
    )


def test_keyboard_interrupt_during_the_first_status_request_cancels_best_effort(
    sleeps: list[float],
) -> None:
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "GET":
            raise KeyboardInterrupt
        return response("research.cancel.done")

    with pytest.raises(KeyboardInterrupt):
        sync_client(handler).research.wait(RUN_ID)

    assert seen == [
        ("GET", f"/v1/research/{RUN_ID}"),
        ("POST", f"/v1/research/{RUN_ID}/cancel"),
    ]


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("interval", [0, 2**31, 10**400])
async def test_run_rejects_bad_poll_settings_before_paying_for_the_create(
    async_mode: bool, interval: int
) -> None:
    handler = Sequence("research.create")
    with pytest.raises(InvalidRequestError) as caught:
        if async_mode:
            await async_client(handler).research.run(
                "agents", poll_interval_ms=interval
            )
        else:
            sync_client(handler).research.run("agents", poll_interval_ms=interval)
    assert caught.value.param == "poll_interval_ms"
    assert handler.calls == 0


def test_network_failure_while_polling_names_the_run(sleeps: list[float]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return response("research.create")
        raise httpx.ConnectError("socket hang up")

    with pytest.raises(ArexNetworkError) as caught:
        sync_client(handler).research.run("agents")

    assert caught.value.code == "request_failed"
    assert caught.value.run_id == RUN_ID


def test_each_status_request_is_bounded_by_the_remaining_poll_budget(
    sleeps: list[float],
) -> None:
    handler = Sequence("research.get.running", "research.get.completed")

    sync_client(handler).research.wait(RUN_ID, timeout_ms=5000)

    assert sleeps == [2.0]
    assert [handler.read_timeout_ms(0), handler.read_timeout_ms(1)] == [5000, 3000]


def test_status_request_cut_short_by_the_poll_budget_is_a_poll_timeout(
    clock: FakeClock,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        clock.advance(0.5)
        raise httpx.ReadTimeout("slow")

    with pytest.raises(ArexTimeoutError) as caught:
        sync_client(handler).research.wait(RUN_ID, timeout_ms=100)

    assert caught.value.phase == "poll"
    assert caught.value.run_id == RUN_ID


def test_cancel_returns_the_cancelled_run() -> None:
    handler = Sequence("research.cancel.done")

    run = sync_client(handler).research.cancel(RUN_ID)

    assert run.status == "cancelled"
    assert handler.requests[0].url.path == f"/v1/research/{RUN_ID}/cancel"


def test_cancel_accepted_while_the_run_is_still_active() -> None:
    run = sync_client(Sequence("research.cancel.pending")).research.cancel(RUN_ID)

    assert run.status == "running"


def test_delete_returns_none_when_the_run_is_gone() -> None:
    handler = Sequence("research.delete.done")

    assert sync_client(handler).research.delete(RUN_ID) is None
    assert handler.requests[0].method == "DELETE"


def test_delete_returns_the_run_while_cancel_is_pending() -> None:
    run = sync_client(Sequence("research.delete.pending")).research.delete(RUN_ID)

    assert run is not None
    assert run.status == "running"
