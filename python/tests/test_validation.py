"""Client-side validation rejects out-of-bound arguments before any request."""

from __future__ import annotations

import pytest
from fixtures import RUN_ID, Sequence, sync_client

from arex import InvalidRequestError


def test_search_query_over_the_limit_is_rejected() -> None:
    handler = Sequence("search.ok")
    arex = sync_client(handler)

    with pytest.raises(InvalidRequestError):
        arex.search("x" * 2001)

    assert handler.calls == 0


def test_search_query_at_the_limit_is_accepted() -> None:
    handler = Sequence("search.ok")

    sync_client(handler).search("x" * 2000)

    assert handler.calls == 1


def test_empty_search_query_is_rejected() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("search.ok")).search("   ")


@pytest.mark.parametrize("limit", [0, 11])
def test_search_limit_outside_the_range_is_rejected(limit: int) -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("search.ok")).search("agents", limit=limit)


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


def test_contents_url_over_the_length_limit_is_rejected() -> None:
    url = "https://example.org/" + "a" * 8192
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents(url)


def test_contents_tier_must_be_known() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents(
            "https://example.org/",
            tier="priority",  # type: ignore[arg-type]
        )


def test_livecrawl_timeout_requires_livecrawl() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents(
            "https://example.org/", livecrawl_timeout_ms=5000
        )


@pytest.mark.parametrize("timeout_ms", [999, 90001])
def test_livecrawl_timeout_outside_the_range_is_rejected(timeout_ms: int) -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents(
            "https://example.org/", livecrawl=True, livecrawl_timeout_ms=timeout_ms
        )


@pytest.mark.parametrize("max_characters", [0, 131073])
def test_max_characters_outside_the_range_is_rejected(max_characters: int) -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("contents.ok")).contents(
            "https://example.org/", max_characters=max_characters
        )


def test_research_mode_must_be_known() -> None:
    with pytest.raises(InvalidRequestError):
        sync_client(Sequence("research.create")).research.create(
            "agents",
            mode="turbo",  # type: ignore[arg-type]
        )


def test_research_detach_must_be_a_boolean() -> None:
    with pytest.raises(InvalidRequestError) as caught:
        sync_client(Sequence("research.create")).research.create(
            "agents",
            detach="yes",  # type: ignore[arg-type]
        )
    assert caught.value.param == "detach"


def test_research_query_over_the_limit_is_rejected() -> None:
    handler = Sequence("research.create")

    with pytest.raises(InvalidRequestError):
        sync_client(handler).research.create("x" * 2001)

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
