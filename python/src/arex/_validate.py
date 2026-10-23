"""Validate requests before sending them using generated wire constraints."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, get_args
from urllib.parse import urlsplit

from arex._wire import WIRE_LIMITS, ContentsTier, ResearchModeRequest
from arex.errors import InvalidRequestError

__all__ = [
    "MAX_TIMEOUT_MS",
    "is_timeout_ms",
    "validate_contents",
    "validate_research_create",
    "validate_research_wait",
    "validate_run_id",
    "validate_search",
    "validate_timeout_ms",
]

_RUN_ID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}"
    r"-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
_UTC_TIMESTAMP_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$"
)


def _integer(field: str, value: object, bounds: dict[str, Any]) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise InvalidRequestError(f"{field} must be an integer.", param=field)
    if not bounds["minimum"] <= value <= bounds["maximum"]:
        raise InvalidRequestError(
            f"{field} must be between {bounds['minimum']} and {bounds['maximum']}.",
            param=field,
        )


def _query(value: str, bounds: dict[str, Any]) -> None:
    if not isinstance(value, str) or not value.strip():
        raise InvalidRequestError("query must be a non-empty string.", param="query")
    # Python string lengths count Unicode code points rather than UTF-16 units.
    if not bounds["minLength"] <= len(value) <= bounds["maxLength"]:
        raise InvalidRequestError(
            f"query must be at most {bounds['maxLength']} characters.", param="query"
        )


def _utc_timestamp_seconds(field: str, value: object) -> int:
    if isinstance(value, str) and _UTC_TIMESTAMP_PATTERN.fullmatch(value):
        try:
            parsed = datetime.fromisoformat(value[:19]).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
        else:
            return int(parsed.timestamp())
    raise InvalidRequestError(f"{field} must be a UTC ISO-8601 timestamp.", param=field)


def validate_search(
    query: str,
    limit: int | None = None,
    *,
    published_after: str | None = None,
    published_before: str | None = None,
) -> None:
    bounds = WIRE_LIMITS["SearchRequest"]
    _query(query, bounds["query"])
    if limit is not None:
        _integer("limit", limit, bounds["limit"])
    after_seconds = (
        _utc_timestamp_seconds("published_after", published_after)
        if published_after is not None
        else None
    )
    before_seconds = (
        _utc_timestamp_seconds("published_before", published_before)
        if published_before is not None
        else None
    )
    if (
        after_seconds is not None
        and before_seconds is not None
        and after_seconds >= before_seconds
    ):
        raise InvalidRequestError(
            "published_before must be after published_after "
            "at whole-second granularity.",
            param="published_before",
        )


def validate_contents(
    url: str,
    *,
    tier: str | None,
    livecrawl: bool | None,
    livecrawl_timeout_ms: int | None,
    max_characters: int | None,
) -> None:
    bounds = WIRE_LIMITS["ContentsRequest"]
    if not isinstance(url, str) or not url.strip():
        raise InvalidRequestError("url must be a non-empty string.", param="url")
    if len(url) > bounds["url"]["maxLength"]:
        raise InvalidRequestError(
            f"url must be at most {bounds['url']['maxLength']} characters.", param="url"
        )
    try:
        parts = urlsplit(url)
        valid_host = parts.hostname
    except ValueError as exc:
        raise InvalidRequestError(
            "url must be an absolute HTTP(S) URL.", param="url"
        ) from exc
    if parts.scheme not in ("http", "https") or not valid_host:
        raise InvalidRequestError("url must be an absolute HTTP(S) URL.", param="url")
    if parts.username is not None or parts.password is not None:
        raise InvalidRequestError("url must not contain credentials.", param="url")
    if tier is not None and tier not in get_args(ContentsTier):
        raise InvalidRequestError("tier must be auto or flex.", param="tier")
    if livecrawl is not None and not isinstance(livecrawl, bool):
        raise InvalidRequestError("livecrawl must be a boolean.", param="livecrawl")
    if livecrawl_timeout_ms is not None:
        if livecrawl is not True:
            raise InvalidRequestError(
                "livecrawl_timeout_ms is only allowed with livecrawl=True.",
                param="livecrawl_timeout_ms",
            )
        _integer(
            "livecrawl_timeout_ms", livecrawl_timeout_ms, bounds["livecrawl_timeout_ms"]
        )
    if max_characters is not None:
        _integer("max_characters", max_characters, bounds["max_characters"])


def validate_research_create(
    query: str, mode: str | None, *, detach: bool = False
) -> None:
    _query(query, WIRE_LIMITS["ResearchCreateRequest"]["query"])
    if mode is not None and mode not in get_args(ResearchModeRequest):
        raise InvalidRequestError("mode must be fast, deep or auto.", param="mode")
    if not isinstance(detach, bool):
        raise InvalidRequestError("detach must be a boolean.", param="detach")


def validate_run_id(run_id: str) -> None:
    if not isinstance(run_id, str) or not _RUN_ID_PATTERN.fullmatch(run_id):
        raise InvalidRequestError("run_id must be a UUID.", param="run_id")


def validate_research_wait(poll_interval_ms: int, timeout_ms: int | None) -> None:
    """Runs before `create` in `run`, so a bad poll setting never pays for a run
    it cannot wait for."""
    if not is_timeout_ms(poll_interval_ms):
        raise InvalidRequestError(
            f"poll_interval_ms must be an integer between 1 and {MAX_TIMEOUT_MS}.",
            param="poll_interval_ms",
        )
    if timeout_ms is not None:
        validate_timeout_ms(timeout_ms)


# The largest delay a JavaScript timer accepts; also keeps the millisecond to
# second conversion and `socket` timeouts far from float overflow.
MAX_TIMEOUT_MS = 2**31 - 1


def is_timeout_ms(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 < value <= MAX_TIMEOUT_MS
    )


def validate_timeout_ms(value: object) -> None:
    if not is_timeout_ms(value):
        raise InvalidRequestError(
            f"timeout_ms must be a positive integer of at most {MAX_TIMEOUT_MS}.",
            param="timeout_ms",
        )
