"""Public result models and SDK-owned defaults."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, get_args

from arex import _wire
from arex._wire import (
    WIRE_LIMITS,
    ContentsTier,
    ResearchFailureCode,
    ResearchMode,
    ResearchModeRequest,
    ResearchStatus,
)

__all__ = [
    "API_KEY_PATTERN",
    "API_KEY_PREFIX",
    "CONTENTS_AUTO_TIMEOUT_MS",
    "CONTENTS_FLEX_TIMEOUT_MS",
    "CONTENTS_TIERS",
    "DEEP_POLL_TIMEOUT_MS",
    "DEFAULT_BASE_URL",
    "DEFAULT_CONTENTS_MAX_CHARACTERS",
    "DEFAULT_CONTENTS_TIER",
    "DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS",
    "DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS",
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_POLL_INTERVAL_MS",
    "DEFAULT_RESEARCH_MODE",
    "DEFAULT_RETRY_DELAY_MS",
    "DEFAULT_SEARCH_LIMIT",
    "FAST_POLL_TIMEOUT_MS",
    "LIVECRAWL_TIMEOUT_MARGIN_MS",
    "RESEARCH_MODES",
    "RESEARCH_REQUEST_TIMEOUT_MS",
    "SEARCH_TIMEOUT_MS",
    "ContentsDocument",
    "ContentsTier",
    "ResearchFailureCode",
    "ResearchMode",
    "ResearchModeRequest",
    "ResearchResult",
    "ResearchRun",
    "ResearchRunError",
    "ResearchSource",
    "ResearchStatus",
    "SearchResponse",
    "SearchResult",
    "is_arex_api_key",
]


# Authentication
API_KEY_PREFIX = "sk_arex_"
API_KEY_PATTERN = re.compile(r"^sk_arex_[A-Za-z0-9_-]{32}$")
DEFAULT_BASE_URL = "https://api.arex-research.com"

DEFAULT_SEARCH_LIMIT = WIRE_LIMITS["SearchRequest"]["limit"]["default"]
CONTENTS_TIERS = get_args(ContentsTier)
DEFAULT_CONTENTS_TIER: ContentsTier = WIRE_LIMITS["ContentsRequest"]["tier"]["default"]
DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS = 20000
DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS = 90000
DEFAULT_CONTENTS_MAX_CHARACTERS = WIRE_LIMITS["ContentsRequest"]["max_characters"][
    "default"
]
RESEARCH_MODES = get_args(ResearchModeRequest)
DEFAULT_RESEARCH_MODE: ResearchModeRequest = WIRE_LIMITS["ResearchCreateRequest"][
    "mode"
]["default"]

# SDK-owned timeout, polling and retry defaults
SEARCH_TIMEOUT_MS = 30000
CONTENTS_AUTO_TIMEOUT_MS = 30000
CONTENTS_FLEX_TIMEOUT_MS = 70000
LIVECRAWL_TIMEOUT_MARGIN_MS = 10000
RESEARCH_REQUEST_TIMEOUT_MS = 30000
DEFAULT_POLL_INTERVAL_MS = 2000
FAST_POLL_TIMEOUT_MS = 150000
DEEP_POLL_TIMEOUT_MS = 180000
DEFAULT_MAX_RETRIES = 2
DEFAULT_RETRY_DELAY_MS = 1000


def is_arex_api_key(value: str) -> bool:
    """Whether `value` has the shape of an AREX API key."""
    return API_KEY_PATTERN.match(value) is not None


def _invalid(field: str) -> Exception:
    from arex.errors import ArexNetworkError

    return ArexNetworkError(
        "invalid_response",
        f"The AREX API response is missing or mistyped the field {field!r}.",
    )


def _object(data: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(data, Mapping):
        raise _invalid(field)
    return data


def _str(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise _invalid(key)
    return value


def _opt_str(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _invalid(key)
    return value


def _bool(data: Mapping[str, Any], key: str) -> bool:
    value = data.get(key)
    if not isinstance(value, bool):
        raise _invalid(key)
    return value


def _nonempty_str(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise _invalid(key)
    return value


@dataclass(frozen=True, slots=True)
class SearchResult:
    """One search hit."""

    title: str
    url: str
    snippet: str | None = None
    published_at: str | None = None

    @classmethod
    def from_wire(cls, data: _wire.SearchResponseResultsItem) -> SearchResult:
        obj = _object(data, "results[]")
        return cls(
            title=_str(obj, "title"),
            url=_str(obj, "url"),
            snippet=_opt_str(obj, "snippet"),
            published_at=_opt_str(obj, "published_at"),
        )


@dataclass(frozen=True, slots=True)
class SearchResponse:
    """The result of `Arex.search`."""

    results: tuple[SearchResult, ...]

    @classmethod
    def from_wire(cls, data: _wire.SearchResponse) -> SearchResponse:
        obj = _object(data, "body")
        results = obj.get("results")
        if not isinstance(results, list):
            raise _invalid("results")
        return cls(
            results=tuple(SearchResult.from_wire(item) for item in results),
        )


@dataclass(frozen=True, slots=True)
class ContentsDocument:
    """The result of `Arex.contents`."""

    url: str
    title: str | None
    published_at: str | None
    image_url: str | None
    image_urls: tuple[str, ...] | None
    content: str
    truncated: bool

    @classmethod
    def from_wire(cls, data: _wire.ContentsResponse) -> ContentsDocument:
        obj = _object(data, "body")
        raw_urls = obj.get("image_urls")
        if raw_urls is None:
            image_urls = None
        elif (
            isinstance(raw_urls, list)
            and len(raw_urls)
            <= WIRE_LIMITS["ContentsResponse"]["image_urls"]["maxItems"]
            and all(isinstance(item, str) for item in raw_urls)
        ):
            image_urls = tuple(raw_urls)
        else:
            raise _invalid("image_urls")
        return cls(
            url=_str(obj, "url"),
            title=_opt_str(obj, "title"),
            published_at=_opt_str(obj, "published_at"),
            image_url=_opt_str(obj, "image_url"),
            image_urls=image_urls,
            content=_str(obj, "content"),
            truncated=_bool(obj, "truncated"),
        )


@dataclass(frozen=True, slots=True)
class ResearchSource:
    """One source cited by a research answer."""

    title: str
    url: str

    @classmethod
    def from_wire(cls, data: _wire.ResearchRunResultSourcesItem) -> ResearchSource:
        obj = _object(data, "result.sources[]")
        return cls(title=_str(obj, "title"), url=_str(obj, "url"))


@dataclass(frozen=True, slots=True)
class ResearchResult:
    """The answer of a completed research run."""

    answer: str
    sources: tuple[ResearchSource, ...]

    @classmethod
    def from_wire(cls, data: _wire.ResearchRunResult) -> ResearchResult:
        obj = _object(data, "result")
        sources = obj.get("sources")
        if not isinstance(sources, list):
            raise _invalid("result.sources")
        return cls(
            answer=_str(obj, "answer"),
            sources=tuple(ResearchSource.from_wire(item) for item in sources),
        )


@dataclass(frozen=True, slots=True)
class ResearchRunError:
    """Why a research run failed."""

    code: ResearchFailureCode
    retryable: bool

    @classmethod
    def from_wire(cls, data: _wire.ResearchRunError) -> ResearchRunError:
        obj = _object(data, "error")
        return cls(
            code=_nonempty_str(obj, "code"),  # type: ignore[arg-type]
            retryable=_bool(obj, "retryable"),
        )


@dataclass(frozen=True, slots=True)
class ResearchRun:
    """A research run; response strings may extend the known Literal annotations."""

    id: str
    status: ResearchStatus
    mode: ResearchMode
    requested_mode: ResearchModeRequest
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    result: ResearchResult | None = None
    error: ResearchRunError | None = None
    message: str | None = None

    @classmethod
    def from_wire(cls, data: _wire.ResearchRun) -> ResearchRun:
        obj = _object(data, "body")
        status = _nonempty_str(obj, "status")
        mode = _nonempty_str(obj, "mode")
        # Payloads are meaningful only in their matching terminal state.
        result = obj.get("result") if status == "completed" else None
        error = obj.get("error") if status == "failed" else None
        message = (
            _opt_str(obj, "message")
            if status not in ("completed", "failed", "cancelled")
            else None
        )
        if status == "completed" and result is None:
            raise _invalid("result")
        if status == "failed" and error is None:
            raise _invalid("error")
        return cls(
            id=_str(obj, "id"),
            status=status,  # type: ignore[arg-type]
            mode=mode,  # type: ignore[arg-type]
            requested_mode=_nonempty_str(obj, "requested_mode"),  # type: ignore[arg-type]
            created_at=_str(obj, "created_at"),
            started_at=_opt_str(obj, "started_at"),
            completed_at=_opt_str(obj, "completed_at"),
            result=None if result is None else ResearchResult.from_wire(result),
            error=None if error is None else ResearchRunError.from_wire(error),
            message=message,
        )
