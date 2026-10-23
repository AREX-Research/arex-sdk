"""The `research` resource: lifecycle calls plus the `wait`/`run` pollers."""

from __future__ import annotations

import asyncio
from contextlib import suppress

from arex._poll import async_poll_until, poll_until
from arex._transport import AsyncTransport, Transport
from arex._validate import (
    validate_research_create,
    validate_research_wait,
    validate_run_id,
)
from arex.errors import (
    ArexError,
    ResearchRunCancelledError,
    ResearchRunFailedError,
)
from arex.models import (
    DEEP_POLL_TIMEOUT_MS,
    DEFAULT_POLL_INTERVAL_MS,
    FAST_POLL_TIMEOUT_MS,
    RESEARCH_REQUEST_TIMEOUT_MS,
    ResearchModeRequest,
    ResearchRun,
)

__all__ = ["AsyncResearch", "Research"]

_TERMINAL = frozenset({"completed", "failed", "cancelled"})


def _create_body(query: str, mode: ResearchModeRequest | None) -> dict[str, object]:
    body: dict[str, object] = {"query": query}
    if mode is not None:
        body["mode"] = mode
    return body


def _create_headers(*, detach: bool, timeout_ms: int) -> dict[str, str] | None:
    if detach:
        return {"Prefer": "respond-async"}
    if timeout_ms >= 22_000:
        return None
    wait_seconds = (timeout_ms - 2_000) // 1_000
    return {"Prefer": "respond-async" if wait_seconds < 1 else f"wait={wait_seconds}"}


def _poll_budget_ms(mode: ResearchModeRequest | None) -> int:
    """Server deadline plus slack, keyed on what the caller asked for: `auto`
    may resolve to either tier, so it gets the deep budget."""
    return FAST_POLL_TIMEOUT_MS if mode == "fast" else DEEP_POLL_TIMEOUT_MS


def _completed(run: ResearchRun) -> ResearchRun:
    """Return a completed run, or raise for the other terminal statuses."""
    if run.status == "completed":
        return run
    if run.status == "failed":
        raise ResearchRunFailedError(run)
    raise ResearchRunCancelledError(run)


class Research:
    """Synchronous research resource, reachable as `Arex.research`."""

    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def _timeout(self, timeout_ms: int | None) -> int:
        return self._transport.resolve_timeout(RESEARCH_REQUEST_TIMEOUT_MS, timeout_ms)

    def create(
        self,
        query: str,
        *,
        mode: ResearchModeRequest | None = None,
        detach: bool = False,
        timeout_ms: int | None = None,
    ) -> ResearchRun:
        """Start a research run."""
        validate_research_create(query, mode, detach=detach)
        resolved_timeout_ms = self._timeout(timeout_ms)
        result = self._transport.request(
            "POST",
            "/v1/research",
            headers=_create_headers(detach=detach, timeout_ms=resolved_timeout_ms),
            json=_create_body(query, mode),
            timeout_ms=resolved_timeout_ms,
        )
        return ResearchRun.from_wire(result.data)

    def get(self, run_id: str, *, timeout_ms: int | None = None) -> ResearchRun:
        """Fetch the current state of a run."""
        return self._fetch(run_id, timeout_ms)[0]

    def cancel(self, run_id: str, *, timeout_ms: int | None = None) -> ResearchRun:
        """Ask the server to cancel a run."""
        validate_run_id(run_id)
        result = self._transport.request(
            "POST",
            f"/v1/research/{run_id}/cancel",
            timeout_ms=self._timeout(timeout_ms),
        )
        return ResearchRun.from_wire(result.data)

    def delete(
        self, run_id: str, *, timeout_ms: int | None = None
    ) -> ResearchRun | None:
        """Delete a run. `None` once it is gone, the run while cancel is pending."""
        validate_run_id(run_id)
        result = self._transport.request(
            "DELETE",
            f"/v1/research/{run_id}",
            timeout_ms=self._timeout(timeout_ms),
        )
        if result.data is None:
            return None
        return ResearchRun.from_wire(result.data)

    def wait(
        self,
        run_id: str,
        *,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
        timeout_ms: int | None = None,
    ) -> ResearchRun:
        """Poll until the run completes. Raises on `failed` and `cancelled`."""
        validate_run_id(run_id)
        validate_research_wait(poll_interval_ms, timeout_ms)
        return self._await_completion(
            run_id,
            None,
            poll_interval_ms=poll_interval_ms,
            timeout_ms=timeout_ms if timeout_ms is not None else DEEP_POLL_TIMEOUT_MS,
        )

    def run(
        self,
        query: str,
        *,
        mode: ResearchModeRequest | None = None,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
        timeout_ms: int | None = None,
    ) -> ResearchRun:
        """Create a run and poll until it completes. Errors raised after the
        create name the run in `run_id`."""
        validate_research_wait(poll_interval_ms, timeout_ms)
        created = self.create(
            query,
            mode=mode,
            timeout_ms=(
                min(RESEARCH_REQUEST_TIMEOUT_MS, timeout_ms)
                if timeout_ms is not None
                else None
            ),
        )
        return self._await_completion(
            created.id,
            created,
            poll_interval_ms=poll_interval_ms,
            timeout_ms=timeout_ms if timeout_ms is not None else _poll_budget_ms(mode),
        )

    def _fetch(
        self, run_id: str, timeout_ms: int | None
    ) -> tuple[ResearchRun, int | None]:
        validate_run_id(run_id)
        result = self._transport.request(
            "GET",
            f"/v1/research/{run_id}",
            timeout_ms=self._timeout(timeout_ms),
        )
        return ResearchRun.from_wire(result.data), result.retry_after_ms

    def _await_completion(
        self,
        run_id: str,
        created: ResearchRun | None,
        *,
        poll_interval_ms: int,
        timeout_ms: int,
    ) -> ResearchRun:
        if created is not None and created.status in _TERMINAL:
            return _completed(created)

        # The create response is the first observation; every later one is a GET
        # bounded by both the request timeout and what is left of the poll budget.
        pending = [created] if created is not None else []

        def get(remaining_ms: int) -> tuple[ResearchRun | None, int | None]:
            if pending:
                current, retry = pending.pop(), None
            else:
                current, retry = self._fetch(
                    run_id, min(self._timeout(None), remaining_ms)
                )
            return (current if current.status in _TERMINAL else None), retry

        try:
            final = poll_until(
                get,
                poll_interval_ms=poll_interval_ms,
                timeout_ms=timeout_ms,
                run_id=run_id,
            )
        except KeyboardInterrupt:
            self._cancel_quietly(run_id)
            raise
        except ArexError as exc:
            if exc.run_id is None:
                exc.run_id = run_id
            raise
        return _completed(final)

    def _cancel_quietly(self, run_id: str) -> None:
        with suppress(ArexError):
            self.cancel(run_id)


class AsyncResearch:
    """Asynchronous research resource, reachable as `AsyncArex.research`."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._transport = transport

    def _timeout(self, timeout_ms: int | None) -> int:
        return self._transport.resolve_timeout(RESEARCH_REQUEST_TIMEOUT_MS, timeout_ms)

    async def create(
        self,
        query: str,
        *,
        mode: ResearchModeRequest | None = None,
        detach: bool = False,
        timeout_ms: int | None = None,
    ) -> ResearchRun:
        """Start a research run."""
        validate_research_create(query, mode, detach=detach)
        resolved_timeout_ms = self._timeout(timeout_ms)
        result = await self._transport.request(
            "POST",
            "/v1/research",
            headers=_create_headers(detach=detach, timeout_ms=resolved_timeout_ms),
            json=_create_body(query, mode),
            timeout_ms=resolved_timeout_ms,
        )
        return ResearchRun.from_wire(result.data)

    async def get(self, run_id: str, *, timeout_ms: int | None = None) -> ResearchRun:
        """Fetch the current state of a run."""
        run, _ = await self._fetch(run_id, timeout_ms)
        return run

    async def cancel(
        self, run_id: str, *, timeout_ms: int | None = None
    ) -> ResearchRun:
        """Ask the server to cancel a run."""
        validate_run_id(run_id)
        result = await self._transport.request(
            "POST",
            f"/v1/research/{run_id}/cancel",
            timeout_ms=self._timeout(timeout_ms),
        )
        return ResearchRun.from_wire(result.data)

    async def delete(
        self, run_id: str, *, timeout_ms: int | None = None
    ) -> ResearchRun | None:
        """Delete a run. `None` once it is gone, the run while cancel is pending."""
        validate_run_id(run_id)
        result = await self._transport.request(
            "DELETE",
            f"/v1/research/{run_id}",
            timeout_ms=self._timeout(timeout_ms),
        )
        if result.data is None:
            return None
        return ResearchRun.from_wire(result.data)

    async def wait(
        self,
        run_id: str,
        *,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
        timeout_ms: int | None = None,
    ) -> ResearchRun:
        """Poll until the run completes. Raises on `failed` and `cancelled`."""
        validate_run_id(run_id)
        validate_research_wait(poll_interval_ms, timeout_ms)
        return await self._await_completion(
            run_id,
            None,
            poll_interval_ms=poll_interval_ms,
            timeout_ms=timeout_ms if timeout_ms is not None else DEEP_POLL_TIMEOUT_MS,
        )

    async def run(
        self,
        query: str,
        *,
        mode: ResearchModeRequest | None = None,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
        timeout_ms: int | None = None,
    ) -> ResearchRun:
        """Create a run and poll until it completes. Errors raised after the
        create name the run in `run_id`."""
        validate_research_wait(poll_interval_ms, timeout_ms)
        created = await self.create(
            query,
            mode=mode,
            timeout_ms=(
                min(RESEARCH_REQUEST_TIMEOUT_MS, timeout_ms)
                if timeout_ms is not None
                else None
            ),
        )
        return await self._await_completion(
            created.id,
            created,
            poll_interval_ms=poll_interval_ms,
            timeout_ms=timeout_ms if timeout_ms is not None else _poll_budget_ms(mode),
        )

    async def _fetch(
        self, run_id: str, timeout_ms: int | None
    ) -> tuple[ResearchRun, int | None]:
        validate_run_id(run_id)
        result = await self._transport.request(
            "GET",
            f"/v1/research/{run_id}",
            timeout_ms=self._timeout(timeout_ms),
        )
        return ResearchRun.from_wire(result.data), result.retry_after_ms

    async def _await_completion(
        self,
        run_id: str,
        created: ResearchRun | None,
        *,
        poll_interval_ms: int,
        timeout_ms: int,
    ) -> ResearchRun:
        if created is not None and created.status in _TERMINAL:
            return _completed(created)

        pending = [created] if created is not None else []

        async def get(remaining_ms: int) -> tuple[ResearchRun | None, int | None]:
            if pending:
                current, retry = pending.pop(), None
            else:
                current, retry = await self._fetch(
                    run_id, min(self._timeout(None), remaining_ms)
                )
            return (current if current.status in _TERMINAL else None), retry

        try:
            final = await async_poll_until(
                get,
                poll_interval_ms=poll_interval_ms,
                timeout_ms=timeout_ms,
                run_id=run_id,
            )
        except asyncio.CancelledError:
            await self._cancel_quietly(run_id)
            raise
        except ArexError as exc:
            if exc.run_id is None:
                exc.run_id = run_id
            raise
        return _completed(final)

    async def _cancel_quietly(self, run_id: str) -> None:
        # Shielded: the caller's task is already being cancelled, so an
        # unshielded await would abort before the request leaves the client.
        with suppress(ArexError, asyncio.CancelledError):
            await asyncio.shield(self.cancel(run_id))
