"""Every recorded error response maps onto the documented error class."""

from __future__ import annotations

import httpx
import pytest
from fixtures import Sequence, sync_client

from arex import (
    ArexApiError,
    ArexNetworkError,
    AuthenticationError,
    CreditsExhaustedError,
    InvalidRequestError,
    NotFoundError,
    RateLimitError,
    ServiceUnavailableError,
    SourceNotAvailableError,
    api_error_from_response,
)

CASES = [
    ("error.unauthorized", AuthenticationError, 401, "unauthorized"),
    ("error.invalid-request", InvalidRequestError, 400, "invalid_request"),
    ("error.content-blocked", InvalidRequestError, 400, "content_blocked"),
    (
        "contents.source-not-available",
        SourceNotAvailableError,
        422,
        "source_not_available",
    ),
    ("error.not-found", NotFoundError, 404, "not_found"),
    ("error.run-not-cancellable", ArexApiError, 409, "run_not_cancellable"),
    ("error.rate-limit", RateLimitError, 429, "rate_limit_exceeded"),
    ("error.outstanding-run-limit", RateLimitError, 429, "outstanding_run_limit"),
    (
        "error.daily-credits-exhausted",
        CreditsExhaustedError,
        429,
        "daily_credits_exhausted",
    ),
    (
        "error.weekly-credits-exhausted",
        CreditsExhaustedError,
        429,
        "weekly_credits_exhausted",
    ),
    (
        "error.temporarily-unavailable",
        ServiceUnavailableError,
        503,
        "temporarily_unavailable",
    ),
    ("error.internal", ServiceUnavailableError, 500, "internal_error"),
]


@pytest.mark.parametrize(("fixture", "cls", "status", "code"), CASES)
def test_error_fixture_maps_to_class(
    fixture: str, cls: type[ArexApiError], status: int, code: str
) -> None:
    arex = sync_client(Sequence(fixture), max_retries=0)

    with pytest.raises(cls) as caught:
        arex.search("agent evaluation")

    error = caught.value
    assert type(error) is cls
    assert error.status == status
    assert error.code == code
    assert error.request_id == "req_9f1c2e7a"


def test_rate_limit_error_exposes_retry_after() -> None:
    arex = sync_client(Sequence("error.rate-limit"), max_retries=0)

    with pytest.raises(RateLimitError) as caught:
        arex.search("agent evaluation")

    assert caught.value.retry_after_ms == 1000
    assert caught.value.retryable is True


@pytest.mark.parametrize(
    ("fixture", "message"),
    [
        ("error.daily-credits-exhausted", "The daily usage allowance is exhausted."),
        ("error.weekly-credits-exhausted", "The weekly usage allowance is exhausted."),
    ],
)
def test_credits_exhausted_error_preserves_public_error_details(
    fixture: str, message: str
) -> None:
    arex = sync_client(Sequence(fixture))

    with pytest.raises(CreditsExhaustedError) as caught:
        arex.search("agent evaluation")

    error = caught.value
    assert str(error) == message
    assert error.retryable is False
    assert error.request_id == "req_9f1c2e7a"
    assert set(error.details) <= {
        "code",
        "message",
        "retryable",
        "request_id",
        "param",
    }
    for field in ("resource", "used", "limit", "requested", "reset_at"):
        assert not hasattr(error, field)


def test_non_json_error_is_an_invalid_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="registration_required")

    with pytest.raises(ArexNetworkError) as caught:
        sync_client(handler).search("agents")

    assert caught.value.code == "invalid_response"


def test_invalid_request_exposes_parameter() -> None:
    with pytest.raises(InvalidRequestError) as caught:
        sync_client(Sequence("error.invalid-request")).search("agents")

    assert caught.value.param == "limit"


def test_method_not_allowed_stays_plain_api_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            405,
            json={
                "error": {
                    "code": "method_not_allowed",
                    "message": "Method not allowed",
                    "retryable": False,
                    "request_id": "req_method",
                }
            },
        )

    with pytest.raises(ArexApiError) as caught:
        sync_client(handler).search("agents")

    assert type(caught.value) is ArexApiError
    assert caught.value.code == "method_not_allowed"
    assert caught.value.param is None


@pytest.mark.parametrize("raw", ["nan", "inf", "-inf"])
def test_non_finite_retry_after_is_ignored(raw: str) -> None:
    error = api_error_from_response(
        429,
        {
            "error": {
                "code": "rate_limit_exceeded",
                "message": "Slow down",
                "retryable": True,
                "request_id": "req_retry",
            }
        },
        {"Retry-After": raw},
    )

    assert isinstance(error, RateLimitError)
    assert error.retry_after_ms is None
