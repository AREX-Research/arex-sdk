"""HTTP plumbing: auth, per-call timeouts, errors, retries."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from typing import Any, NamedTuple

import httpx

from arex._validate import is_timeout_ms, validate_timeout_ms
from arex.errors import (
    ArexNetworkError,
    ArexTimeoutError,
    RateLimitError,
    ServiceUnavailableError,
    api_error_from_response,
    retry_after_ms_from_headers,
)
from arex.models import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_DELAY_MS,
)

__all__ = ["ApiResult", "AsyncTransport", "Transport"]


class ApiResult(NamedTuple):
    """One decoded successful response."""

    data: Any
    retry_after_ms: int | None


def _prepare(
    base_url: str,
    api_key: str,
    path: str,
    extra_headers: Mapping[str, str] | None = None,
) -> tuple[str, dict[str, str]]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    if extra_headers is not None:
        headers.update(extra_headers)
    return base_url.rstrip("/") + path, headers


def _attempt_headers(headers: dict[str, str], attempt: int) -> dict[str, str]:
    if attempt > 0 and headers.get("Prefer", "").startswith("wait="):
        return {**headers, "Prefer": "respond-async"}
    return headers


def _decode(response: httpx.Response) -> ApiResult:
    retry_after_ms = retry_after_ms_from_headers(response.headers)

    if not 200 <= response.status_code < 300:
        try:
            body: Any = response.json()
        except ValueError as exc:
            raise ArexNetworkError("invalid_response") from exc
        raise api_error_from_response(response.status_code, body, response.headers)

    if response.status_code == 204 or not response.content:
        return ApiResult(None, retry_after_ms)

    try:
        data = response.json()
    except ValueError as exc:
        raise ArexNetworkError("invalid_response") from exc

    return ApiResult(data, retry_after_ms)


class _Base:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_ms: int | None,
        max_retries: int,
        retry_unavailable: bool,
    ) -> None:
        if timeout_ms is not None and not is_timeout_ms(timeout_ms):
            raise ValueError("timeout_ms must be a positive integer")
        if (
            isinstance(max_retries, bool)
            or not isinstance(max_retries, int)
            or max_retries < 0
        ):
            raise ValueError("max_retries must be a non-negative integer")
        self.api_key = api_key
        self.base_url = base_url
        self.timeout_ms = timeout_ms
        self.max_retries = max_retries
        self.retry_unavailable = retry_unavailable

    def resolve_timeout(self, default_ms: int, override_ms: int | None) -> int:
        """Per-call argument beats the client-level override beats the default."""
        if override_ms is not None:
            validate_timeout_ms(override_ms)
            return override_ms
        if self.timeout_ms is not None:
            return self.timeout_ms
        return default_ms

    def _retry_delay_ms(
        self,
        error: RateLimitError | ServiceUnavailableError,
        attempt: int,
    ) -> int | None:
        """Milliseconds to wait before retrying, or `None` to give up."""
        if attempt >= self.max_retries:
            return None
        if isinstance(error, RateLimitError):
            # `outstanding_run_limit` is a state, not a burst; retrying never helps.
            if error.code != "rate_limit_exceeded":
                return None
        elif not self.retry_unavailable or error.code != "temporarily_unavailable":
            return None
        if error.retry_after_ms is not None:
            return error.retry_after_ms
        return DEFAULT_RETRY_DELAY_MS

    def _retry_sleep(
        self,
        error: RateLimitError | ServiceUnavailableError,
        attempt: int,
        deadline: float,
    ) -> float | None:
        """Seconds to sleep, capped to the deadline, or `None` if not retryable."""
        delay_ms = self._retry_delay_ms(error, attempt)
        if delay_ms is None:
            return None
        return min(delay_ms / 1000, max(0.0, deadline - time.monotonic()))


def _attempt_timeout(attempt: int, timeout_ms: int, deadline: float) -> httpx.Timeout:
    """httpx timeouts are per phase, so each attempt gets what is left of the
    one budget (the first gets all of it)."""
    seconds = timeout_ms / 1000 if attempt == 0 else deadline - time.monotonic()
    if seconds <= 0:
        raise ArexTimeoutError("request", timeout_ms)
    return httpx.Timeout(seconds)


class Transport(_Base):
    """Synchronous transport over `httpx.Client`.

    Each attempt gives its I/O phases the remaining budget. The SDK checks
    elapsed time after a response, but cannot interrupt a blocking call, so
    a server that keeps trickling bytes can outlast the budget.
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_ms: int | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_unavailable: bool = False,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            timeout_ms=timeout_ms,
            max_retries=max_retries,
            retry_unavailable=retry_unavailable,
        )
        self.owns_client = client is None
        self.client = client if client is not None else httpx.Client(base_url=base_url)

    def request(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        json: Any | None = None,
        timeout_ms: int,
    ) -> ApiResult:
        url, req_headers = _prepare(self.base_url, self.api_key, path, headers)
        deadline = time.monotonic() + timeout_ms / 1000
        attempt = 0
        while True:
            timeout = _attempt_timeout(attempt, timeout_ms, deadline)
            try:
                response = self.client.request(
                    method,
                    url,
                    headers=_attempt_headers(req_headers, attempt),
                    json=json,
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                raise ArexTimeoutError("request", timeout_ms) from exc
            except httpx.HTTPError as exc:
                raise ArexNetworkError("request_failed") from exc
            if time.monotonic() >= deadline:
                raise ArexTimeoutError("request", timeout_ms)
            try:
                return _decode(response)
            except (RateLimitError, ServiceUnavailableError) as error:
                delay = self._retry_sleep(error, attempt, deadline)
                if delay is None:
                    raise
                time.sleep(delay)
                attempt += 1

    def close(self) -> None:
        if self.owns_client:
            self.client.close()


class AsyncTransport(_Base):
    """Asynchronous transport over `httpx.AsyncClient`.

    The budget is a wall-clock deadline: when it passes, the in-flight request
    or retry sleep is cancelled.
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_ms: int | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_unavailable: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            timeout_ms=timeout_ms,
            max_retries=max_retries,
            retry_unavailable=retry_unavailable,
        )
        self.owns_client = client is None
        self.client = (
            client if client is not None else httpx.AsyncClient(base_url=base_url)
        )

    async def request(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        json: Any | None = None,
        timeout_ms: int,
    ) -> ApiResult:
        url, req_headers = _prepare(self.base_url, self.api_key, path, headers)
        deadline = time.monotonic() + timeout_ms / 1000
        work = asyncio.ensure_future(
            self._send(method, url, req_headers, json, timeout_ms, deadline)
        )
        # Not `asyncio.wait_for`: before Python 3.12 it can swallow a caller's
        # cancellation that lands as the request finishes, and `asyncio.timeout`
        # needs 3.11. Waiting on the task keeps both cases explicit.
        try:
            done, _ = await asyncio.wait({work}, timeout=timeout_ms / 1000)
        except asyncio.CancelledError:
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)
            raise
        if work in done:
            return work.result()
        work.cancel()
        await asyncio.gather(work, return_exceptions=True)
        raise ArexTimeoutError("request", timeout_ms)

    async def _send(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        json: Any | None,
        timeout_ms: int,
        deadline: float,
    ) -> ApiResult:
        attempt = 0
        while True:
            timeout = _attempt_timeout(attempt, timeout_ms, deadline)
            try:
                response = await self.client.request(
                    method,
                    url,
                    headers=_attempt_headers(headers, attempt),
                    json=json,
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                raise ArexTimeoutError("request", timeout_ms) from exc
            except httpx.HTTPError as exc:
                raise ArexNetworkError("request_failed") from exc
            if time.monotonic() >= deadline:
                raise ArexTimeoutError("request", timeout_ms)
            try:
                return _decode(response)
            except (RateLimitError, ServiceUnavailableError) as error:
                delay = self._retry_sleep(error, attempt, deadline)
                if delay is None:
                    raise
                await asyncio.sleep(delay)
                attempt += 1

    async def aclose(self) -> None:
        if self.owns_client:
            await self.client.aclose()
