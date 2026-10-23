"""Fixed-interval polling with a deadline.

`get` receives the milliseconds left before the deadline and returns
`(value, retry_after_ms)`: a non-`None` value ends the loop, and the
`Retry-After` of the most recent response overrides the fixed interval.
Inputs are validated by the resource before creating a run.
"""

from __future__ import annotations

import asyncio
import math
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from arex.errors import ArexError, ArexTimeoutError

__all__ = ["async_poll_until", "poll_until"]

T = TypeVar("T")


def _delay_seconds(retry_after_ms: int | None, poll_interval_ms: int) -> float:
    return (retry_after_ms if retry_after_ms is not None else poll_interval_ms) / 1000


def _remaining_ms(deadline: float) -> int:
    return math.ceil((deadline - time.monotonic()) * 1000)


def _poll_timeout(
    exc: ArexError,
    *,
    deadline: float,
    remaining_ms: int,
    timeout_ms: int,
    run_id: str,
) -> ArexTimeoutError | None:
    """Only elapsed time or a request capped by the poll budget is a poll timeout.

    Retry eligibility belongs to the transport. A server Retry-After header
    must not relabel a non-retried API error before the poll deadline.
    """
    now = time.monotonic()
    cut = (
        isinstance(exc, ArexTimeoutError)
        and exc.phase == "request"
        and exc.timeout_ms >= remaining_ms
    )
    if cut or now >= deadline:
        return ArexTimeoutError("poll", timeout_ms, run_id)
    return None


def poll_until(
    get: Callable[[int], tuple[T | None, int | None]],
    *,
    poll_interval_ms: int,
    timeout_ms: int,
    run_id: str,
) -> T:
    """Call `get` until it yields a value, or raise `ArexTimeoutError`.

    An outcome that arrives after the deadline is a poll timeout, whatever it is.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        remaining_ms = _remaining_ms(deadline)
        if remaining_ms <= 0:
            raise ArexTimeoutError("poll", timeout_ms, run_id)
        try:
            value, retry_after_ms = get(remaining_ms)
        except ArexError as exc:
            timeout = _poll_timeout(
                exc,
                deadline=deadline,
                remaining_ms=remaining_ms,
                timeout_ms=timeout_ms,
                run_id=run_id,
            )
            if timeout is None:
                raise
            raise timeout from exc
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ArexTimeoutError("poll", timeout_ms, run_id)
        if value is not None:
            return value
        time.sleep(min(_delay_seconds(retry_after_ms, poll_interval_ms), remaining))


async def async_poll_until(
    get: Callable[[int], Awaitable[tuple[T | None, int | None]]],
    *,
    poll_interval_ms: int,
    timeout_ms: int,
    run_id: str,
) -> T:
    """Await `get` until it yields a value, or raise `ArexTimeoutError`."""
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        remaining_ms = _remaining_ms(deadline)
        if remaining_ms <= 0:
            raise ArexTimeoutError("poll", timeout_ms, run_id)
        try:
            value, retry_after_ms = await get(remaining_ms)
        except ArexError as exc:
            timeout = _poll_timeout(
                exc,
                deadline=deadline,
                remaining_ms=remaining_ms,
                timeout_ms=timeout_ms,
                run_id=run_id,
            )
            if timeout is None:
                raise
            raise timeout from exc
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ArexTimeoutError("poll", timeout_ms, run_id)
        if value is not None:
            return value
        await asyncio.sleep(
            min(_delay_seconds(retry_after_ms, poll_interval_ms), remaining)
        )
