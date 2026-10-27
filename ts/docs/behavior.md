# Behavior

The rules the client follows, and the reason for each. Signatures are in the [API reference](api.md).

## Validation before the network

The client checks only what it needs to build a request: argument types, a well-formed `http(s)` URL without credentials, publication timestamps, and the options it owns. A failed check throws `InvalidRequestError` (`status: 0`) with `param` before any network call. Value limits on request fields (lengths, ranges, allowed values) belong to the server, which can change them without a new SDK release; a value past one is sent and the server's `400 invalid_request` surfaces as `InvalidRequestError`. Client checks include every `timeoutMs` / `pollIntervalMs`, which must be positive and at most 2147483647 ms (the longest delay a JavaScript timer honours; the `Arex` constructor throws `TypeError` for the same limit on its `timeoutMs`). `run` also checks its poll settings before creating a run. Server validation errors preserve the server's actionable `message`, `requestId`, and `param`. [CONTRACT.md](../../CONTRACT.md) records SDK-owned policy only.

Responses are validated at the same seam. A malformed response raises `ArexNetworkError("invalid_response")`: for example, a non-string research status, a completed run with malformed sources, or invalid contents image metadata. Research response-validation errors carry `runId` when it is known, including from direct lifecycle calls. Direct API or network errors from those calls do not generally carry it; `wait` and `run` enrich SDK errors after the run is known.

## Forward compatibility

Extra response fields are ignored. New API error codes surface as `ArexApiError` with the original code. Unknown non-empty `mode`, `requestedMode`, and failure-code strings pass through unchanged. Unknown `status` strings are treated as in progress: `wait`/`run` keep polling under the existing interval, `Retry-After`, and deadline rules, raising a poll timeout with `runId` if no known terminal status arrives. The `ResearchRun` type lists known statuses to preserve result/error narrowing; runtime responses may include newer statuses.

## Timeouts

Each request gets its own deadline derived from the server's, plus 10s, so the client never gives up just before the server would have answered:

| Call | Deadline |
| --- | --- |
| `search` | 30s |
| `contents` `auto` / `flex` | 30s / 70s |
| `contents` with `livecrawl` | `livecrawlTimeoutMs` (or the server default, auto 20s / flex 90s) + 10s |
| `research.*` lifecycle calls | 30s |

Precedence: per-call `timeoutMs`, then the client `timeoutMs`, then the table. The deadline is one wall-clock budget for the whole call: the first attempt, every retry sleep and every retried attempt share it, and a retry sleep is cut short to what remains. Expiry aborts the in-flight request and raises `ArexTimeoutError` with `phase: "request"`. A caller `signal` always wins over the deadline. Poll deadlines (below) are separate and are not affected by the client `timeoutMs`, which would otherwise cut a legitimate multi-minute run short.

## Retries

Retries are new requests. The SDK sends no deduplication header and the server does not replay earlier responses. Repeating a research create after a lost response or timeout may create another run.

`429 rate_limit_exceeded` is retried up to `maxRetries` (2) times, waiting `Retry-After` or 1s (a zero `Retry-After` still yields to the event loop), abortable through `signal` and bounded by the call deadline. `retryUnavailable: true` additionally retries `503 temporarily_unavailable`. `outstanding_run_limit`, allowance-exhaustion errors and `internal_error` are never retried. The server's `retryable` describes transient failures; it does not replace this bounded SDK policy.

## Research polling

### Default flow

`research.create` can return a terminal run (`200` with `completed`, `failed`, or `cancelled`) or an in-progress run (`202` with `queued` or `running`). An informational `message` is kept on in-progress statuses, including unknown ones, and omitted on known terminal statuses. Passing `detach: true` requests an immediate asynchronous response after admission.

`research.run` creates a run and polls only if it is still in progress. `research.wait` polls an existing run. Both poll `GET /v1/research/{id}` every 2s by default; a `Retry-After` on a poll response overrides the interval once. See the [API docs](https://www.arex-research.com/platform/docs/concepts/rate-limits) for current server rate limits.

Both helpers resolve only on `completed`, so `run.result` is never optional. A terminal create response is handled without polling. `failed` raises `ResearchRunFailedError` and `cancelled` raises `ResearchRunCancelledError`; each carries the run.

### Deadlines

`create` adapts its `Prefer` header to the request timeout, shortening synchronous waiting or requesting an asynchronous response so the server can return an ID before the client deadline. Retried waiting requests switch to asynchronous responses. The exact client policy is in [CONTRACT.md](../../CONTRACT.md#sdk-owned-defaults).

When `timeoutMs` is passed to `run`, it also caps the create request timeout at the smaller of that value and the default research request timeout. The poll deadline defaults to 150s for explicit `fast`, or 180s for `deep`, `auto`, and `wait` (whose mode is unknown up front). It is separate from the client request timeout.

Each status request is bounded by its own request deadline and the remaining poll budget. Retry waits spend that same budget. A poll delay longer than the remaining budget ends in a poll timeout rather than another request.

### Stopping early

- A caller abort (`signal`) during polling sends a best-effort `cancel` for the run, ignores its outcome, and rethrows `signal.reason`. Aborting during `create`, before a response carries a run ID, aborts the HTTP request without sending a cancel call.
- A poll deadline raises `ArexTimeoutError` with `phase: "poll"` and `runId`. It stops waiting but leaves the run untouched.

### Recovery

Every error leaving `wait` or `run` after the run exists carries `runId` (the `ArexError` base field), including a network failure or API error on a status request. Resume with `wait(runId)` or explicitly stop the run with `cancel(runId)`.

A timeout or network error on `search`, `contents`, or before a create response does not say whether the server admitted the request. Retries are new requests and may repeat work. Persist IDs returned by `create` and use `get`/`wait` across processes instead of creating the same work again; `run` is the one-call form.

## Error mapping

Every JSON API error is an `ArexApiError` subclass chosen by status and `code` (table in the [API reference](api.md#errors)). It preserves the server `message`, `requestId`, and optional validation `param`; `details` retains only the contract error fields (`code`, `message`, `retryable`, `request_id`, `param`). Subclasses distinguish authentication, permission denial, bad input, unavailable source, not found, rate limits, exhausted allowances, and service unavailability. `CreditsExhaustedError` has no additional fields. `409 run_not_cancellable` and unknown JSON codes stay plain `ArexApiError`. Transport failures are `ArexNetworkError`; malformed responses, non-JSON errors, and JSON errors without the `error` envelope (a proxy's `502` page, say) are `invalid_response` rather than guessed codes.

## Transport

`fetch` is the single seam: the client builds an absolute URL and an init with `method`, `headers`, `body` and `signal`, and expects a WHATWG `Response`. A custom `fetch` must honor `signal` by rejecting when it aborts; the client does not race the adapter, so one that ignores `signal` can outlive the deadline and caller aborts. Injecting a function is how to add logging, proxies or a test double; there is no plugin or middleware layer. Nothing Node-specific is imported, which is what keeps Bun and edge runtimes working.
