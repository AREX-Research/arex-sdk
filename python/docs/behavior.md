# Behavior

The rules the client follows, and the reason for each. Signatures are in the [API reference](api.md). `Arex` and `AsyncArex` behave identically; only the calling convention differs.

## Validation before the network

The client checks limits generated from the checked-in OpenAPI contract and raises `InvalidRequestError` (`status == 0`) before sending invalid input. Both `timeout_ms` and `poll_interval_ms` must be integers from 1 through 2147483647, excluding booleans. `run` checks these settings before creating a run. Server errors retain their message, request ID and optional field-level `param`.

Research responses require a result when completed and an error when failed; missing or malformed terminal payloads raise `ArexNetworkError("invalid_response")` in direct lifecycle calls as well as polling. `message` is retained on in-progress states; `result` and `error` are retained only in their matching terminal states.

## Forward compatibility

Extra response fields are ignored, and new API error codes remain `ArexApiError` with their `code`. Unknown nonempty Research modes, requested modes, and failure codes pass through; request modes still require a known value. Unknown statuses also pass through, retain `message`, and count as in progress without requiring `result` or `error`. `wait`/`run` continue polling with the same interval, `Retry-After`, deadline, and `run_id` timeout rules. `Literal` annotations describe known values only; empty or mistyped values for these response fields remain invalid.

## Timeouts

Each request gets its own deadline derived from the server's, plus 10s, so the client never gives up just before the server would have answered:

| Call | Deadline |
| --- | --- |
| `search` | 30s |
| `contents` `auto` / `flex` | 30s / 70s |
| `contents` with `livecrawl` | `livecrawl_timeout_ms` (or the server default, auto 20s / flex 90s) + 10s |
| `research.*` lifecycle calls | 30s |

Precedence: per-call `timeout_ms`, then the client `timeout_ms`, then the table. The value is one budget for the whole call, including automatic retries and their waits; each attempt's `httpx.Timeout` (connect, write, read, pool, each separately) is whatever is left of it. Expiry raises `ArexTimeoutError` with `phase == "request"`. Poll deadlines (below) are separate and are not affected by the client `timeout_ms`, which would otherwise cut a legitimate multi-minute run short.

`AsyncArex` enforces the budget as a wall-clock deadline and cancels the in-flight request or retry wait when it passes (Python 3.10 compatible). `Arex` is synchronous and cannot interrupt a blocking socket call: each attempt gives its I/O phases the remaining budget, but a server that keeps trickling bytes can run past `timeout_ms` (as can a slow `http_client` transport). Elapsed time is checked again after each response and before each retry; a late response raises a request timeout rather than returning success. Use `AsyncArex` when a hard wall-clock limit matters.

## Retries

`rate_limit_exceeded` is rejected before admission and is retried up to `max_retries` (2) times, waiting `Retry-After` (delta-seconds or an HTTP date; a date without a zone counts as UTC; malformed values are ignored and absurdly large ones are clamped to 2147483647 ms) or 1s. `retry_unavailable=True` extends the policy to `temporarily_unavailable`. The SDK sends no deduplication header. The whole call, retries and waits included, shares one `timeout_ms` budget: retry waits are capped to what remains and expiry raises `ArexTimeoutError`. A deadline never causes a retry earlier than the server permits. `outstanding_run_limit` is a state conflict, not a burst, so it is never retried. `retryable` describes the server failure; it does not independently enable a client retry.

## Research polling

### Default flow

`research.create` can return a terminal run (`200` with `completed`, `failed`, or `cancelled`) or an in-progress run (`202` with `queued` or `running`). An informational `message` is retained on in-progress states, including unknown statuses. Passing `detach=True` requests an immediate asynchronous response after admission.

`research.run` creates a run and polls only if it is still in progress. `research.wait` polls an existing run. Both poll `GET /v1/research/{id}` every 2s by default; a `Retry-After` on a poll response overrides the interval once. See the [API docs](https://www.arex-research.com/platform/docs/concepts/rate-limits) for current server rate limits.

Both helpers return only on `completed`, so `result` is set (it stays optional in the type because `ResearchRun` is one dataclass for every status). A terminal create response is handled without polling. `failed` raises `ResearchRunFailedError` and `cancelled` raises `ResearchRunCancelledError`; each carries the run.

### Deadlines

`create` adapts its `Prefer` header to the request timeout, shortening synchronous waiting or requesting an asynchronous response so the server can return an ID before the client deadline. Retried waiting requests switch to asynchronous responses. The exact client policy is in [CONTRACT.md](../../CONTRACT.md#sdk-owned-defaults).

When `timeout_ms` is passed to `run`, it also caps the create request timeout at the smaller of that value and the default research request timeout. The poll deadline defaults to 150s for explicit `fast`, or 180s for `deep`, `auto`, and `wait` (whose mode is unknown up front). It is separate from the client request timeout.

Each status request is bounded by its own request deadline and the remaining poll budget. Retry waits spend that same budget. A poll delay longer than the remaining budget ends in a poll timeout rather than another request. A request cut short by the poll budget, or an outcome arriving after the poll deadline (even a terminal response), surfaces as a poll timeout. Before that deadline, non-retried errors retain their original type: a long `Retry-After` does not hide an outstanding-run limit, a disabled retry, or an unavailable error.

### Stopping early

- Interrupting the caller (`KeyboardInterrupt`, or cancelling the task under asyncio) during polling sends a best-effort `cancel` for the run (shielded from cancellation under asyncio), ignores its outcome, and re-raises. This includes the first status request. Interrupting during `create`, before a response carries a run ID, aborts the HTTP request without sending a cancel call.
- A poll deadline raises `ArexTimeoutError` with `phase == "poll"` and `run_id`. It stops waiting but leaves the run untouched.

### Recovery

Every SDK error leaving `wait` or `run` after the run exists carries `run_id`, including a network failure or API error on a status request. Resume with `wait(run_id)` or explicitly stop the run with `cancel(run_id)`.

A timeout or network error on `search`, `contents`, or before a create response does not say whether the server admitted the request. Retries are new requests and may repeat work. Persist IDs returned by `create` and use `get`/`wait` across processes instead of creating the same work again; `run` is the one-call form.

## Error mapping

Every API error is an `ArexApiError` subclass chosen by status and `code` (table in the [API reference](api.md#errors)). Authentication failures (401) and permission failures (403) are distinct: `AuthenticationError` and `PermissionDeniedError`. Errors preserve the server message, `code`, `retryable`, optional `request_id` and `param`. `CreditsExhaustedError` identifies daily or weekly allowance exhaustion without additional accounting fields. `run_not_cancellable`, `method_not_allowed` and unknown codes remain plain `ArexApiError`. Transport failures are `ArexNetworkError`; non-JSON errors and other off-contract responses are `invalid_response` rather than guessed values.

## Transport

`httpx` is the single seam. Pass `http_client` to control connection pooling, proxies, event hooks or a `MockTransport` for tests; the SDK sets the URL, auth header, JSON body and per-call timeout on each request and never closes a client it did not create.
