"""The synchronous `Arex` client."""

from __future__ import annotations

import os
from types import TracebackType
from typing import Any

import httpx

from arex._transport import Transport
from arex._validate import validate_contents, validate_search
from arex.models import (
    CONTENTS_AUTO_TIMEOUT_MS,
    CONTENTS_FLEX_TIMEOUT_MS,
    DEFAULT_BASE_URL,
    DEFAULT_CONTENTS_TIER,
    DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS,
    DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS,
    DEFAULT_MAX_RETRIES,
    LIVECRAWL_TIMEOUT_MARGIN_MS,
    SEARCH_TIMEOUT_MS,
    ContentsDocument,
    ContentsTier,
    SearchResponse,
)
from arex.research import Research

__all__ = ["Arex"]


def resolve_api_key(api_key: str | None) -> str:
    """The explicit key, else `AREX_API_KEY`."""
    key = api_key if api_key is not None else os.environ.get("AREX_API_KEY")
    if not key:
        raise ValueError(
            "An AREX API key is required: pass api_key= or set AREX_API_KEY."
        )
    return key


def search_body(
    query: str,
    limit: int | None,
    published_after: str | None,
    published_before: str | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"query": query}
    if limit is not None:
        body["limit"] = limit
    if published_after is not None:
        body["published_after"] = published_after
    if published_before is not None:
        body["published_before"] = published_before
    return body


def contents_body(
    url: str,
    tier: ContentsTier | None,
    livecrawl: bool | None,
    livecrawl_timeout_ms: int | None,
    max_characters: int | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"url": url}
    if tier is not None:
        body["tier"] = tier
    if livecrawl is not None:
        body["livecrawl"] = livecrawl
    if livecrawl_timeout_ms is not None:
        body["livecrawl_timeout_ms"] = livecrawl_timeout_ms
    if max_characters is not None:
        body["max_characters"] = max_characters
    return body


def contents_timeout_ms(
    tier: ContentsTier | None,
    livecrawl: bool | None,
    livecrawl_timeout_ms: int | None,
) -> int:
    """The server deadline that applies to this contents call, plus the margin."""
    effective_tier: ContentsTier = tier if tier is not None else DEFAULT_CONTENTS_TIER
    if livecrawl:
        server_deadline = (
            livecrawl_timeout_ms
            if livecrawl_timeout_ms is not None
            else (
                DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS
                if effective_tier == "auto"
                else DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS
            )
        )
        return server_deadline + LIVECRAWL_TIMEOUT_MARGIN_MS
    return (
        CONTENTS_AUTO_TIMEOUT_MS
        if effective_tier == "auto"
        else CONTENTS_FLEX_TIMEOUT_MS
    )


class Arex:
    """Synchronous client for the AREX public API."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout_ms: int | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_unavailable: bool = False,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._transport = Transport(
            api_key=resolve_api_key(api_key),
            base_url=base_url or DEFAULT_BASE_URL,
            timeout_ms=timeout_ms,
            max_retries=max_retries,
            retry_unavailable=retry_unavailable,
            client=http_client,
        )
        self.research = Research(self._transport)

    def search(
        self,
        query: str,
        *,
        limit: int | None = None,
        published_after: str | None = None,
        published_before: str | None = None,
        timeout_ms: int | None = None,
    ) -> SearchResponse:
        """Run a web search."""
        validate_search(
            query,
            limit,
            published_after=published_after,
            published_before=published_before,
        )
        result = self._transport.request(
            "POST",
            "/v1/search",
            json=search_body(query, limit, published_after, published_before),
            timeout_ms=self._transport.resolve_timeout(SEARCH_TIMEOUT_MS, timeout_ms),
        )
        return SearchResponse.from_wire(result.data)

    def contents(
        self,
        url: str,
        *,
        tier: ContentsTier | None = None,
        livecrawl: bool | None = None,
        livecrawl_timeout_ms: int | None = None,
        max_characters: int | None = None,
        timeout_ms: int | None = None,
    ) -> ContentsDocument:
        """Fetch and extract one page."""
        validate_contents(
            url,
            tier=tier,
            livecrawl=livecrawl,
            livecrawl_timeout_ms=livecrawl_timeout_ms,
            max_characters=max_characters,
        )
        default_ms = contents_timeout_ms(tier, livecrawl, livecrawl_timeout_ms)
        result = self._transport.request(
            "POST",
            "/v1/contents",
            json=contents_body(
                url, tier, livecrawl, livecrawl_timeout_ms, max_characters
            ),
            timeout_ms=self._transport.resolve_timeout(default_ms, timeout_ms),
        )
        return ContentsDocument.from_wire(result.data)

    def close(self) -> None:
        """Close the HTTP client, unless it was injected."""
        self._transport.close()

    def __enter__(self) -> Arex:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()
