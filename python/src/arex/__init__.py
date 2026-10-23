"""Python SDK for the AREX public API: search, contents, research."""

import importlib.metadata

from arex.async_client import AsyncArex
from arex.client import Arex
from arex.errors import (
    ArexApiError,
    ArexError,
    ArexNetworkError,
    ArexTimeoutError,
    AuthenticationError,
    CreditsExhaustedError,
    InvalidRequestError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    ResearchRunCancelledError,
    ResearchRunFailedError,
    ServiceUnavailableError,
    SourceNotAvailableError,
    api_error_from_response,
)
from arex.models import (
    API_KEY_PREFIX,
    CONTENTS_AUTO_TIMEOUT_MS,
    CONTENTS_FLEX_TIMEOUT_MS,
    CONTENTS_TIERS,
    DEEP_POLL_TIMEOUT_MS,
    DEFAULT_BASE_URL,
    DEFAULT_CONTENTS_MAX_CHARACTERS,
    DEFAULT_CONTENTS_TIER,
    DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS,
    DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS,
    DEFAULT_MAX_RETRIES,
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_RESEARCH_MODE,
    DEFAULT_RETRY_DELAY_MS,
    DEFAULT_SEARCH_LIMIT,
    FAST_POLL_TIMEOUT_MS,
    LIVECRAWL_TIMEOUT_MARGIN_MS,
    RESEARCH_MODES,
    RESEARCH_REQUEST_TIMEOUT_MS,
    SEARCH_TIMEOUT_MS,
    ContentsDocument,
    ContentsTier,
    ResearchFailureCode,
    ResearchMode,
    ResearchModeRequest,
    ResearchResult,
    ResearchRun,
    ResearchRunError,
    ResearchSource,
    ResearchStatus,
    SearchResponse,
    SearchResult,
    is_arex_api_key,
)
from arex.research import AsyncResearch, Research


def __getattr__(name: str) -> str:
    # Read lazily from the installed distribution so the version has a single
    # source (pyproject.toml); an uninstalled tree raises rather than guessing.
    if name == "__version__":
        return importlib.metadata.version("arex-python-sdk")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
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
    "Arex",
    "ArexApiError",
    # errors
    "ArexError",
    "ArexNetworkError",
    "ArexTimeoutError",
    "AsyncArex",
    "AsyncResearch",
    "AuthenticationError",
    "ContentsDocument",
    # models
    "ContentsTier",
    "CreditsExhaustedError",
    "InvalidRequestError",
    "NotFoundError",
    "PermissionDeniedError",
    "RateLimitError",
    "Research",
    "ResearchFailureCode",
    "ResearchMode",
    "ResearchModeRequest",
    "ResearchResult",
    "ResearchRun",
    "ResearchRunCancelledError",
    "ResearchRunError",
    "ResearchRunFailedError",
    "ResearchSource",
    "ResearchStatus",
    "SearchResponse",
    "SearchResult",
    "ServiceUnavailableError",
    "SourceNotAvailableError",
    "__version__",
    "api_error_from_response",
    # contract constants
    "is_arex_api_key",
]
