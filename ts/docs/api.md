# API reference

Everything below is exported from `@arex-research/ts-sdk`. Exact types are in the package's `.d.ts`; this page records the surface and its meaning.

## `new Arex(options?)`

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `AREX_API_KEY` | `sk_arex_` plus 32 base64url characters; missing from both sources throws `TypeError` |
| `baseUrl` | `https://api.arex-research.com` | absolute http(s) URL, no credentials, query or fragment; a path prefix is kept |
| `fetch` | `globalThis.fetch` | the only transport seam, see [behavior](behavior.md#transport) |
| `timeoutMs` | per call | overrides every derived request timeout (one deadline for all retry attempts and sleeps); positive, at most 2147483647; does not touch poll deadlines |
| `maxRetries` | `2` | retries for `rate_limit_exceeded` |
| `retryUnavailable` | `false` | also retry 503 `temporarily_unavailable` |

Every call accepts `signal?: AbortSignal` and `timeoutMs?: number`. Retries are new requests; see [behavior](behavior.md#retries).

## Calls

| Call | Returns | Wire |
| --- | --- | --- |
| `search(query, { limit?, publishedAfter?, publishedBefore? })` | `SearchResponse` | `POST /v1/search` |
| `contents(url, { tier?, livecrawl?, livecrawlTimeoutMs?, maxCharacters? })` | `ContentsDocument` | `POST /v1/contents` |
| `research.create(query, { mode?, detach? })` | `ResearchRun` (`200` terminal or `202` `queued`/`running`) | `POST /v1/research` |
| `research.get(runId)` | `ResearchRun` | `GET /v1/research/{id}` |
| `research.cancel(runId)` | `ResearchRun` | `POST /v1/research/{id}/cancel` |
| `research.delete(runId)` | `ResearchRun \| undefined` (`undefined` once deleted, the run while cancel-then-delete is pending) | `DELETE /v1/research/{id}` |
| `research.wait(runId, { pollIntervalMs?, timeoutMs? })` | `CompletedResearchRun` | polls `GET` |
| `research.run(query, { mode?, pollIntervalMs?, timeoutMs? })` | `CompletedResearchRun` | create, then polls if non-terminal |

### Options

The server owns value limits for request fields (lengths, ranges, allowed values) and answers a value past one with `InvalidRequestError` (`status: 400`, `param`); see the [API reference](https://www.arex-research.com/platform/docs). The client checks only what it needs to build a request.

| Option | Type | Default | Client check |
| --- | --- | --- | --- |
| `query` | `string` | | string |
| `limit` | `number` | server default | integer |
| `publishedAfter` | `string` | | UTC ISO-8601 timestamp (`…Z`); sent as `published_after` |
| `publishedBefore` | `string` | | UTC ISO-8601 timestamp (`…Z`), after `publishedAfter` at whole-second granularity; sent as `published_before` |
| `url` | `string` | | absolute `http:`/`https:`, no credentials |
| `tier` | `"auto" \| "flex"` | `"auto"` | string; `flex` buys the longer server deadline |
| `livecrawl` | `boolean` | `false` | fetch now instead of serving a cached copy |
| `livecrawlTimeoutMs` | `number` | server default | integer; only with `livecrawl: true`; sent as `livecrawl_timeout_ms` |
| `maxCharacters` | `number` | server default | integer; sent as `max_characters` |
| `mode` | `"fast" \| "deep" \| "auto"` | `"auto"` | string; the server resolves `auto` to a tier |
| `detach` | `boolean` | `false` | send `Prefer: respond-async` on `POST /v1/research` to return `202` immediately after admission |
| `runId` | `string` | | UUID |
| `pollIntervalMs` | `number` | 2000 | positive, at most 2147483647; `Retry-After` wins when present |
| `timeoutMs` (wait/run) | `number` | fast 150000, else 180000 | positive, at most 2147483647; bounds the whole poll loop |

A failed client check throws `InvalidRequestError` with `status: 0` and `param` before any request.

## Result shapes

| Type | Fields |
| --- | --- |
| `SearchResponse` | `results: SearchResult[]` |
| `SearchResult` | `title`, `url`, `snippet?`, `publishedAt?` |
| `ContentsDocument` | `url`, `title?`, `publishedAt?`, `imageUrl?`, `imageUrls?` (at most 50), `content`, `truncated` |
| `ResearchRunBase` | `id`, `mode: ResearchMode`, `requestedMode: ResearchModeRequest`, `createdAt`, `startedAt?`, `completedAt?`, `message?` (absent on known terminal statuses) |
| `ResearchRun` | discriminated union of known statuses: `queued`/`running`/`cancelled`; `completed` adds `result`; `failed` adds `error: { code: ResearchFailureCode, retryable }`. A newer server may return another status at runtime |
| `CompletedResearchRun` | the `completed` member, `result: { answer, sources: { title, url }[] }` |

Wire fields are renamed to camelCase (`created_at` to `createdAt`).

`ResearchMode`, response-side `ResearchModeRequest`, and `ResearchFailureCode` include known wire values plus other strings. `requestedMode` preserves the requested mode while `mode` identifies the resolved execution mode. Request options keep the generated `"fast" | "deep" | "auto"` mode enum.

### Forward compatibility

Extra response fields are ignored. New API error codes surface as `ArexApiError` with the original code. Unknown non-empty `mode`, `requestedMode`, and failure-code strings pass through unchanged; unknown `status` strings are treated as in progress by `wait`/`run`, subject to the existing polling deadline.

## Errors

| Class | Raised for |
| --- | --- |
| `ArexError` | root of everything the SDK raises on purpose; `runId?` names the run when the error left `wait`/`run` |
| `ArexApiError` | any API error: server `message`, `status`, `code` (`ArexApiErrorCode`: a contract code, or a string for codes added server-side), `retryable`, `requestId?`, `param?`, `retryAfterMs?`, `details` (only `code`, `message`, `retryable`, `request_id?`, `param?` from the `error` body) |
| `AuthenticationError` | 401 `unauthorized` |
| `PermissionDeniedError` | 403 `registration_required`, `account_deletion_pending` |
| `InvalidRequestError` | 400 `invalid_request`, `content_blocked`; client-side validation (`status: 0`) |
| `SourceNotAvailableError` | 422 `source_not_available` |
| `NotFoundError` | 404 `not_found` |
| `RateLimitError` | 429 `rate_limit_exceeded`, `outstanding_run_limit` |
| `CreditsExhaustedError` | 429 `daily_credits_exhausted`, `weekly_credits_exhausted`; no additional fields |
| `ServiceUnavailableError` | 503 `temporarily_unavailable`, 500 `internal_error` |
| `ArexNetworkError` | `code: "request_failed"` (no response, original error in `cause`) or `"invalid_response"` (body off contract) |
| `ArexTimeoutError` | `phase: "request"` or `"poll"`, `timeoutMs` |
| `ResearchRunFailedError`, `ResearchRunCancelledError` | terminal `failed` / `cancelled` from `wait`/`run`; carry `run` |

409 `run_not_cancellable` and unknown JSON error codes surface as plain `ArexApiError`. Non-JSON errors and JSON errors without the `error` envelope are off contract and raise `ArexNetworkError` with `code: "invalid_response"`. A caller abort rethrows `signal.reason`, which is not an `ArexError`.

## Other exports

- `isArexApiKey(value)`, `AREX_API_KEY_PREFIX`, `AREX_API_KEY_SECRET_LENGTH`.
- `ResearchResource`: the `arex.research` resource class.
- `validateSearch`, `validateContents`, `validateResearchCreate`, `validateRunId`, `validateResearchWait`: the same client checks the calls run, for use before queueing work. They do not check server-owned limits.
- `apiErrorFromResponse(status, body, headers)`: the status-and-code to class mapping above; returns `ArexNetworkError` for an envelope-less body.
- `DEFAULT_BASE_URL`: the default API origin.
- `WIRE_LIMITS`: the server-owned constraint table generated from the [OpenAPI](../../openapi/arex-v1.json) copy this release was built with. The server may since have changed a limit; the client does not enforce it.
- Types: `ArexOptions`, `ArexApiErrorInit`, `CallOptions`, `SearchOptions`, `ContentsOptions`, `ResearchCreateOptions`, `ResearchWaitOptions`, `ResearchRunOptions`, `FetchLike`, `ContentsTier`, `ResearchMode`, `ResearchModeRequest`, `ResearchStatus`, `ArexErrorCode`, `ArexApiErrorCode`, `ResearchFailureCode`, `ResearchResult`, `ResearchSource`, and the result shapes above.

Client-policy defaults are also exported for convenience and may change in minor versions. See [CONTRACT.md](../../CONTRACT.md#sdk-owned-defaults) for the current policy.
