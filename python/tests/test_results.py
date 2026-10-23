"""Wire responses map onto the public result models."""

from __future__ import annotations

import httpx
import pytest
from fixtures import Sequence, sync_client

from arex import ArexNetworkError


def test_search_maps_results() -> None:
    handler = Sequence("search.ok")
    arex = sync_client(handler)

    response = arex.search(
        "agent evaluation",
        limit=2,
        published_after="2026-08-01T00:00:00Z",
        published_before="2026-09-01T00:00:00Z",
    )

    assert [result.url for result in response.results] == [
        "https://example.org/agents",
        "https://example.org/no-snippet",
    ]
    assert response.results[0].snippet == "A survey of evaluation methods."
    assert response.results[0].published_at == "2026-09-01T00:00:00.000Z"
    assert response.results[1].snippet is None
    assert response.results[1].published_at is None
    assert not hasattr(response, "credits")

    request = handler.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/v1/search"
    assert handler.request_json() == {
        "query": "agent evaluation",
        "limit": 2,
        "published_after": "2026-08-01T00:00:00Z",
        "published_before": "2026-09-01T00:00:00Z",
    }
    assert request.headers["authorization"].startswith("Bearer sk_arex_")


def test_search_omits_optional_fields_when_not_provided() -> None:
    handler = Sequence("search.ok")
    sync_client(handler).search("agent evaluation")

    assert handler.request_json() == {"query": "agent evaluation"}


def test_search_rejects_mistyped_published_at() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "title": "AI agent evaluation survey",
                        "url": "https://example.org/agents",
                        "published_at": 123,
                    }
                ]
            },
        )

    with pytest.raises(ArexNetworkError) as caught:
        sync_client(handler).search("agents")

    assert caught.value.code == "invalid_response"


def test_contents_maps_document() -> None:
    handler = Sequence("contents.ok")
    arex = sync_client(handler)

    document = arex.contents(
        "https://example.org/agents",
        tier="flex",
        livecrawl=True,
        livecrawl_timeout_ms=5000,
        max_characters=1000,
    )

    assert handler.requests[0].method == "POST"
    assert handler.requests[0].url.path == "/v1/contents"
    assert document.title == "AI agent evaluation survey"
    assert document.image_urls == ("https://example.org/a.png",)
    assert document.published_at == "2026-09-01T00:00:00.000Z"
    assert document.image_url == "https://example.org/hero.png"
    assert document.content == "Body text."
    assert document.truncated is False
    assert not hasattr(document, "credits")
    assert handler.request_json() == {
        "url": "https://example.org/agents",
        "tier": "flex",
        "livecrawl": True,
        "livecrawl_timeout_ms": 5000,
        "max_characters": 1000,
    }


def test_contents_minimal_document_omits_optional_fields() -> None:
    document = sync_client(Sequence("contents.minimal")).contents(
        "https://example.org/plain"
    )

    assert document.title is None
    assert document.image_urls is None
    assert document.published_at is None
    assert document.image_url is None
    assert document.truncated is True
