"""The asynchronous `AsyncArex` client."""

from __future__ import annotations

from types import TracebackType

import httpx

from arex._transport import AsyncTransport
from arex._validate import validate_contents, validate_search
from arex.client import (
    contents_body,
    contents_timeout_ms,
    resolve_api_key,
    search_body,
)
from arex.models import (
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    SEARCH_TIMEOUT_MS,
    ContentsDocument,
    ContentsTier,
    SearchResponse,
)
from arex.research import AsyncResearch

__all__ = ["AsyncArex"]


class AsyncArex:
    """Asynchronous client for the AREX public API."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout_ms: int | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_unavailable: bool = False,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._transport = AsyncTransport(
            api_key=resolve_api_key(api_key),
            base_url=base_url or DEFAULT_BASE_URL,
            timeout_ms=timeout_ms,
            max_retries=max_retries,
            retry_unavailable=retry_unavailable,
            client=http_client,
        )
        self.research = AsyncResearch(self._transport)

    async def search(
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
        result = await self._transport.request(
            "POST",
            "/v1/search",
            json=search_body(query, limit, published_after, published_before),
            timeout_ms=self._transport.resolve_timeout(SEARCH_TIMEOUT_MS, timeout_ms),
        )
        return SearchResponse.from_wire(result.data)

    async def contents(
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
        result = await self._transport.request(
            "POST",
            "/v1/contents",
            json=contents_body(
                url, tier, livecrawl, livecrawl_timeout_ms, max_characters
            ),
            timeout_ms=self._transport.resolve_timeout(default_ms, timeout_ms),
        )
        return ContentsDocument.from_wire(result.data)

    async def aclose(self) -> None:
        """Close the HTTP client, unless it was injected."""
        await self._transport.aclose()

    async def __aenter__(self) -> AsyncArex:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()
