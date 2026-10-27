# API reference

Everything below is importable from `arex`. This page records the surface and its meaning; signatures are typed in the package (`py.typed`).

## `Arex(...)` and `AsyncArex(...)`

`Arex(api_key=None, *, base_url=None, timeout_ms=None, max_retries=2, retry_unavailable=False, http_client=None)`; `AsyncArex` takes the same arguments with an `httpx.AsyncClient`.

| Argument | Default | Meaning |
| --- | --- | --- |
| `api_key` | `AREX_API_KEY` | `sk_arex_` plus 32 base64url characters; missing from both sources raises `ValueError` |
| `base_url` | `https://api.arex-research.com` | a path prefix is kept |
| `timeout_ms` | per call | overrides every derived request timeout (one budget for the call including its retries); positive integer up to 2147483647, else `ValueError`; does not touch poll deadlines |
| `max_retries` | `2` | retries for `rate_limit_exceeded`; must be a non-negative integer (not `bool`), else `ValueError` |
| `retry_unavailable` | `False` | also retry 503 `temporarily_unavailable` |
| `http_client` | created | an injected client is used as is and never closed by the SDK, see [behavior](behavior.md#transport) |

`Arex` is a context manager (`with`), `AsyncArex` an async one (`async with`); `close()` / `await aclose()` are explicit alternatives. Every call takes a keyword-only `timeout_ms`.

## Calls

Synchronous on `Arex`, coroutines on `AsyncArex`.

| Call | Returns | Wire |
| --- | --- | --- |
| `search(query, *, limit=None, published_after=None, published_before=None)` | `SearchResponse` | `POST /v1/search` |
| `contents(url, *, tier=None, livecrawl=None, livecrawl_timeout_ms=None, max_characters=None)` | `ContentsDocument` | `POST /v1/contents` |
| `research.create(query, *, mode=None, detach=False)` | `ResearchRun` (`200` terminal or `202` `queued`/`running`) | `POST /v1/research` |
| `research.get(run_id)` | `ResearchRun` | `GET /v1/research/{id}` |
| `research.cancel(run_id)` | `ResearchRun` | `POST /v1/research/{id}/cancel` |
| `research.delete(run_id)` | `ResearchRun \| None` (`None` once deleted, the run while cancel-then-delete is pending) | `DELETE /v1/research/{id}` |
| `research.wait(run_id, *, poll_interval_ms=2000, timeout_ms=None)` | `ResearchRun` with `status == "completed"` | polls `GET` |
| `research.run(query, *, mode=None, poll_interval_ms=2000, timeout_ms=None)` | `ResearchRun` with `status == "completed"` | create, then polls if non-terminal |

### Options

The server owns value limits for request fields (lengths, ranges, allowed values) and answers a value past one with `InvalidRequestError` (`status == 400`, `param`); see the [API reference](https://www.arex-research.com/platform/docs). The client checks only what it needs to build a request.

| Option | Type | Default | Client check |
| --- | --- | --- | --- |
| `query` | `str` | | string |
| `limit` | `int` | server default | integer |
| `published_after` | `str` | | UTC ISO-8601 timestamp (`…Z`) |
| `published_before` | `str` | | UTC ISO-8601 timestamp (`…Z`), after `published_after` at whole-second granularity |
| `url` | `str` | | absolute `http`/`https`, no credentials |
| `tier` | `Literal["auto", "flex"]` | `"auto"` | string; `flex` buys the longer server deadline |
| `livecrawl` | `bool` | `False` | fetch now instead of serving a cached copy |
| `livecrawl_timeout_ms` | `int` | server default | integer; only with `livecrawl=True` |
| `max_characters` | `int` | server default | integer |
| `mode` | `Literal["fast", "deep", "auto"]` | `"auto"` | string; the server resolves `auto` to a tier |
| `detach` | `bool` | `False` | send `Prefer: respond-async` on `POST /v1/research` to return `202` immediately after admission |
| `run_id` | `str` | | UUID |
| `poll_interval_ms` | `int` | 2000 | 1 to 2147483647; `Retry-After` wins when present |
| `timeout_ms` (wait/run) | `int` | fast 150000, else 180000 | 1 to 2147483647; bounds the whole poll loop |

A failed client check raises `InvalidRequestError` with `status == 0` before any request. A per-call `timeout_ms` (every call, and `wait`/`run`) must be a positive integer, not a `bool`, of at most 2147483647; the constructor applies the same rule to `timeout_ms` but raises `ValueError`.

## Models

Frozen dataclasses; request and response wire fields use snake_case. Wire types and constraints are generated from the checked-in [OpenAPI contract](../../openapi/arex-v1.json).

| Model | Fields |
| --- | --- |
| `SearchResponse` | `results: tuple[SearchResult, ...]` |
| `SearchResult` | `title`, `url`, `snippet`, `published_at` |
| `ContentsDocument` | `url`, `title`, `published_at`, `image_url`, `image_urls` (at most 50), `content`, `truncated`; optional metadata is `None` when absent |
| `ResearchRun` | `id`, `status`, `mode` (known: `"fast"` or `"deep"`), `requested_mode` (known: `"fast"`, `"deep"` or `"auto"`), `created_at`, `started_at`, `completed_at`, `result` (set exactly when `completed`), `error` (set exactly when `failed`), `message` (set on in-progress states) |
| `ResearchResult` | `answer`, `sources: tuple[ResearchSource, ...]` |
| `ResearchSource` | `title`, `url` |
| `ResearchRunError` | `code: ResearchFailureCode`, `retryable` |

Type aliases: `ContentsTier`, `ResearchMode`, `ResearchModeRequest`, `ResearchStatus`, `ResearchFailureCode`. Known `ResearchFailureCode` values are `"timeout" | "execution_failed" | "worker_unavailable" | "interrupted"`.

### Forward compatibility

Extra response fields are ignored. New API error codes remain `ArexApiError` with their original `code`. Unknown nonempty Research modes, requested modes, failure codes, and statuses pass through at runtime, even though the `Literal` annotations list only known values. Unknown statuses are in progress: they retain `message`, require neither `result` nor `error`, and keep `wait`/`run` polling under the usual deadline. Empty or mistyped values for these fields remain invalid responses; the server decides which request modes it accepts.

## Errors

| Class | Raised for |
| --- | --- |
| `ArexError` | root of everything the SDK raises on purpose; `run_id` names the run when the error left `wait`/`run`, else `None` |
| `ArexApiError` | any API error: `status`, `code`, `retryable`, `retry_after_ms`, optional `request_id` and `param`, `details` (the contract's `code`, `message`, `retryable`, `request_id` and `param` fields); the exception message is the server's `message` |
| `AuthenticationError` | 401 `unauthorized` |
| `PermissionDeniedError` | 403 `registration_required`, `account_deletion_pending` |
| `InvalidRequestError` | 400 `invalid_request`, `content_blocked`; client-side validation (`status == 0`) |
| `SourceNotAvailableError` | 422 `source_not_available` |
| `NotFoundError` | 404 `not_found` |
| `RateLimitError` | 429 `rate_limit_exceeded`, `outstanding_run_limit` |
| `CreditsExhaustedError` | 429 `daily_credits_exhausted`, `weekly_credits_exhausted`; no additional fields |
| `ServiceUnavailableError` | 503 `temporarily_unavailable`, 500 `internal_error` |
| `ArexNetworkError` | `code == "request_failed"` (no response, cause chained) or `"invalid_response"` (body off contract) |
| `ArexTimeoutError` | `phase` `"request"` or `"poll"`, `timeout_ms` |
| `ResearchRunFailedError`, `ResearchRunCancelledError` | terminal `failed` / `cancelled` from `wait`/`run`; carry `run` |

409 `run_not_cancellable`, `method_not_allowed` and unknown codes surface as plain `ArexApiError`. Non-JSON error responses and JSON errors without the `error` envelope raise `ArexNetworkError` with `code == "invalid_response"`. `KeyboardInterrupt` and `asyncio.CancelledError` propagate unchanged.

## Other exports

- `is_arex_api_key(value)`, `API_KEY_PREFIX`, `__version__` (read from the installed `arex-python-sdk` distribution metadata; accessing it from an uninstalled source tree raises `importlib.metadata.PackageNotFoundError`).
- `Research`, `AsyncResearch`: the `arex.research` resource classes on `Arex` and `AsyncArex`.
- `api_error_from_response(status, body, headers)`: the status-and-code to class mapping above.
- `DEFAULT_BASE_URL`: the default API origin. Server constraints belong to the [OpenAPI contract](../../openapi/arex-v1.json) rather than public hand-written limit constants.

Client-policy defaults are also exported for convenience and may change in minor versions. See [CONTRACT.md](../../CONTRACT.md#sdk-owned-defaults) for the current policy.
