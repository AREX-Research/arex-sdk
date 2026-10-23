"""Error hierarchy raised by the AREX SDK."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from arex.models import ResearchRun

__all__ = [
    "ArexApiError",
    "ArexError",
    "ArexNetworkError",
    "ArexTimeoutError",
    "AuthenticationError",
    "CreditsExhaustedError",
    "InvalidRequestError",
    "NotFoundError",
    "PermissionDeniedError",
    "RateLimitError",
    "ResearchRunCancelledError",
    "ResearchRunFailedError",
    "ServiceUnavailableError",
    "SourceNotAvailableError",
    "api_error_from_response",
]

NetworkErrorCode = Literal["request_failed", "invalid_response"]
TimeoutPhase = Literal["request", "poll"]


class ArexError(Exception):
    """Base class for every error raised by this SDK.

    `run_id` names the research run being polled when the error surfaced, so
    the caller can `wait(run_id)` again or `cancel(run_id)`. It is `None`
    outside `wait`/`run`.
    """

    run_id: str | None = None


class ArexApiError(ArexError):
    """An error response returned by the AREX API."""

    def __init__(
        self,
        message: str,
        *,
        status: int,
        code: str,
        retryable: bool = False,
        retry_after_ms: int | None = None,
        request_id: str | None = None,
        param: str | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.retryable = retryable
        self.retry_after_ms = retry_after_ms
        self.request_id = request_id
        self.param = param
        self.details: Mapping[str, Any] = dict(details or {})


class AuthenticationError(ArexApiError):
    """401 `unauthorized`."""


class PermissionDeniedError(ArexApiError):
    """403 permission or account access denied."""


class InvalidRequestError(ArexApiError):
    """Invalid request, blocked content, or client-side validation."""

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        code: str = "invalid_request",
        retryable: bool = False,
        retry_after_ms: int | None = None,
        request_id: str | None = None,
        param: str | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message,
            status=status,
            code=code,
            retryable=retryable,
            retry_after_ms=retry_after_ms,
            request_id=request_id,
            param=param,
            details=details,
        )


class SourceNotAvailableError(ArexApiError):
    """422 `source_not_available`."""


class NotFoundError(ArexApiError):
    """404 `not_found`."""


class RateLimitError(ArexApiError):
    """Rate limits or outstanding runs."""


class CreditsExhaustedError(ArexApiError):
    """429 `daily_credits_exhausted` / `weekly_credits_exhausted`."""


class ServiceUnavailableError(ArexApiError):
    """503 `temporarily_unavailable` / 500 `internal_error`."""


class ArexNetworkError(ArexError):
    """The request never produced a usable response."""

    def __init__(self, code: NetworkErrorCode, message: str | None = None) -> None:
        super().__init__(message or _NETWORK_MESSAGES[code])
        self.code = code


_NETWORK_MESSAGES: dict[str, str] = {
    "request_failed": "The request to the AREX API failed.",
    "invalid_response": "The AREX API returned a response the SDK cannot parse.",
}


class ArexTimeoutError(ArexError):
    """A request or a research poll exceeded its deadline."""

    def __init__(
        self,
        phase: TimeoutPhase,
        timeout_ms: int,
        run_id: str | None = None,
    ) -> None:
        subject = "Research run" if phase == "poll" else "Request"
        suffix = f" (run {run_id})" if run_id else ""
        super().__init__(f"{subject} timed out after {timeout_ms} ms{suffix}.")
        self.phase = phase
        self.timeout_ms = timeout_ms
        self.run_id = run_id


class ResearchRunFailedError(ArexError):
    """A research run reached the terminal `failed` status."""

    def __init__(self, run: ResearchRun) -> None:
        retryable = run.error.retryable if run.error else False
        super().__init__(f"Research run {run.id} failed (retryable={retryable}).")
        self.run = run
        self.run_id = run.id


class ResearchRunCancelledError(ArexError):
    """A research run reached the terminal `cancelled` status."""

    def __init__(self, run: ResearchRun) -> None:
        super().__init__(f"Research run {run.id} was cancelled.")
        self.run = run
        self.run_id = run.id


_ERROR_CLASSES: dict[str, type[ArexApiError]] = {
    "invalid_request": InvalidRequestError,
    "content_blocked": InvalidRequestError,
    "source_not_available": SourceNotAvailableError,
    "not_found": NotFoundError,
    "rate_limit_exceeded": RateLimitError,
    "outstanding_run_limit": RateLimitError,
    "daily_credits_exhausted": CreditsExhaustedError,
    "weekly_credits_exhausted": CreditsExhaustedError,
    "temporarily_unavailable": ServiceUnavailableError,
    "internal_error": ServiceUnavailableError,
}


def _header(headers: Mapping[str, str], name: str) -> str | None:
    target = name.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return value
    return None


# Longest wait the SDK will report. A server asking for more than this means
# "not soon", and clamping keeps the arithmetic and `sleep` calls in range.
_MAX_RETRY_AFTER_MS = 2**31 - 1
_DELTA_SECONDS = re.compile(r"[0-9]+(?:\.[0-9]+)?")


def _clamp_ms(ms: float) -> int:
    return _MAX_RETRY_AFTER_MS if ms >= _MAX_RETRY_AFTER_MS else max(0, int(ms))


def retry_after_ms_from_headers(headers: Mapping[str, str]) -> int | None:
    """`Retry-After` in milliseconds; accepts delta-seconds or an HTTP date.

    Malformed values give `None`; huge ones clamp instead of overflowing.
    """
    raw = _header(headers, "Retry-After")
    if raw is None:
        return None
    text = raw.strip()
    if _DELTA_SECONDS.fullmatch(text):
        # ASCII digits never fail `float`, but a long run of them is `inf`.
        return _clamp_ms(float(text) * 1000)
    try:
        at = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if at.tzinfo is None:
        # A date without a zone (`-0000`) is still GMT per RFC 9110.
        at = at.replace(tzinfo=timezone.utc)
    return _clamp_ms((at - datetime.now(timezone.utc)).total_seconds() * 1000)


def api_error_from_response(
    status: int,
    body: Any,
    headers: Mapping[str, str],
) -> ArexApiError:
    """Map a wire error response onto the matching SDK error class."""
    retry_after_ms = retry_after_ms_from_headers(headers)

    if not isinstance(body, dict) or not isinstance(body.get("error"), dict):
        raise ArexNetworkError("invalid_response")
    details = {
        key: value
        for key, value in body["error"].items()
        if key in {"code", "message", "retryable", "request_id", "param"}
    }
    code = details.get("code")
    message = details.get("message")
    retryable = details.get("retryable")
    request_id = details.get("request_id")
    param = details.get("param")
    if (
        not isinstance(code, str)
        or not isinstance(message, str)
        or not isinstance(retryable, bool)
        or (request_id is not None and not isinstance(request_id, str))
        or (param is not None and not isinstance(param, str))
    ):
        raise ArexNetworkError("invalid_response")

    if status == 401:
        cls: type[ArexApiError] = AuthenticationError
    elif status == 403:
        cls = PermissionDeniedError
    else:
        cls = _ERROR_CLASSES.get(code, ArexApiError)
    return cls(
        message,
        status=status,
        code=code,
        retryable=retryable,
        retry_after_ms=retry_after_ms,
        request_id=request_id,
        param=param,
        details=details,
    )
