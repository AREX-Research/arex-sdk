"""The SDK checks only what it needs to build a request; the server owns value
limits, and its invalid_request answer reaches the caller unchanged."""

from __future__ import annotations

from typing import Any

import pytest
from fixtures import RUN_ID, Sequence, sync_client

from arex import InvalidRequestError


@pytest.mark.parametrize(
    "timestamp",
    [
        "not a timestamp",
        "2026-02-30T00:00:00Z",
        "2026-10-01",
        "2026-10-01T00:00:00+08:00",
    ],
)
def test_search_publication_bounds_must_be_utc_timestamps(timestamp: str) -> None:
    handler = Sequence("search.ok")
    arex = sync_client(handler)

    with pytest.raises(InvalidRequestError) as after_exc:
        arex.search("agents", published_after=timestamp)
    assert after_exc.value.param == "published_after"

    with pytest.raises(InvalidRequestError) as before_exc:
        arex.search("agents", published_before=timestamp)
    assert before_exc.value.param == "published_before"
    assert handler.calls == 0


@pytest.mark.parametrize(
    ("published_after", "published_before"),
    [
        ("2026-10-15T00:00:00Z", "2026-10-15T00:00:00Z"),
        ("2026-10-16T00:00:00Z", "2026-10-15T00:00:00Z"),
        ("2026-10-15T00:00:00.100Z", "2026-10-15T00:00:00.900Z"),
    ],
)
def test_search_published_after_must_precede_published_before(
    published_after: str, published_before: str
) -> None:
    handler = Sequence("search.ok")

    with pytest.raises(InvalidRequestError) as caught:
        sync_client(handler).search(
            "agents",
            published_after=published_after,
            published_before=published_before,
        )

    assert caught.value.param == "published_before"
    assert handler.calls == 0


def test_search_publication_bounds_at_adjacent_seconds_are_accepted() -> None:
    handler = Sequence("search.ok")

    sync_client(handler).search(
        "agents",
        published_after="2026-10-15T00:00:00.900Z",
        published_before="2026-10-15T00:00:01.100Z",
    )

    assert handler.request_json() == {
        "query": "agents",
        "published_after": "2026-10-15T00:00:00.900Z",
        "published_before": "2026-10-15T00:00:01.100Z",
    }


def test_contents_url_scheme_is_restricted_to_http() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents("ftp://example.org/file")


def test_contents_url_with_credentials_is_rejected() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents("https://user:pw@example.org/")


def test_livecrawl_timeout_requires_livecrawl() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents(
            "https://example.org/", livecrawl_timeout_ms=5000
        )


def test_research_detach_must_be_a_boolean() -> None:
    with pytest.raises(InvalidRequestError) as caught:
        sync_client(Sequence("research.create")).research.create(
            "agents",
            detach="yes",  # type: ignore[arg-type]
        )
    assert caught.value.param == "detach"


@pytest.mark.parametrize(
    ("call", "param"),
    [
        (lambda arex: arex.search("agents", limit=0), "limit"),
        (lambda arex: arex.search("x" * 2001), "query"),
        (lambda arex: arex.search("   "), "query"),
        (lambda arex: arex.contents("https://example.org/" + "a" * 8192), "url"),
        (lambda arex: arex.contents("https://example.org/", tier="priority"), "tier"),
        (
            lambda arex: arex.contents(
                "https://example.org/", livecrawl=True, livecrawl_timeout_ms=999
            ),
            "livecrawl_timeout_ms",
        ),
        (
            lambda arex: arex.contents("https://example.org/", max_characters=10**9),
            "max_characters",
        ),
        (lambda arex: arex.research.create("x" * 2001), "query"),
        (lambda arex: arex.research.create("agents", mode="turbo"), "mode"),
    ],
)
def test_values_past_server_limits_are_sent_and_the_server_rejects_them(
    call: Any, param: str
) -> None:
    handler = Sequence("error.invalid-request")

    with pytest.raises(InvalidRequestError) as caught:
        call(sync_client(handler))

    assert handler.calls == 1
    assert caught.value.status == 400
    assert caught.value.request_id == "req_9f1c2e7a"
    assert param in handler.request_json()


@pytest.mark.parametrize(
    ("field", "value"), [("max_characters", "600"), ("max_characters", 1.5)]
)
def test_arguments_of_the_wrong_type_are_rejected_before_sending(
    field: str, value: Any
) -> None:
    handler = Sequence("contents.ok")

    with pytest.raises(InvalidRequestError) as caught:
        sync_client(handler).contents("https://example.org/", **{field: value})

    assert caught.value.param == field
    assert handler.calls == 0


def test_run_id_must_be_a_uuid() -> None:
    handler = Sequence("research.get.queued")

    with pytest.raises(InvalidRequestError):
        sync_client(handler).research.get("not-a-uuid")

    assert handler.calls == 0


def test_valid_run_id_reaches_the_transport() -> None:
    handler = Sequence("research.get.queued")

    sync_client(handler).research.get(RUN_ID)

    assert handler.requests[0].url.path == f"/v1/research/{RUN_ID}"
