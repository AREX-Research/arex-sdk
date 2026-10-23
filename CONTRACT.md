# Contract

The checked-in server contract is `openapi/arex-v1.json`. Both SDKs generate their wire types from it (`ts/src/wire.ts`, `python/src/arex/_wire.py`) and expose the published operations. Ordinary builds and contributor checks use the checked-in file directly and need no external repository access. Limits, field names, error codes and headers are owned by that document and are not restated here.

`fixtures/` holds recorded responses on the same contract; both test suites load them.

## SDK-owned defaults

These are client policy, not server facts. Client-policy defaults are exported for convenience and may change in minor versions.

| Default | Value | Rule |
| --- | --- | --- |
| Request timeout: search | 30000 ms | fixed |
| Request timeout: contents without livecrawl | auto 30000, flex 70000 ms | server deadline + 10000 |
| Request timeout: contents with livecrawl | `livecrawl_timeout_ms` (or the server default) + 10000 ms | |
| Request timeout: research create/get/cancel/delete | 30000 ms | fixed |
| Research create `Prefer` header | `respond-async` when `detach` is true, when request timeout < 3000 ms, or on a retry attempt replacing `wait=…`; `wait=<floor((timeoutMs - 2000) / 1000)>` when not detached and 3000 ms <= request timeout < 22000 ms; omitted otherwise | bounds synchronous waiting so the server returns `202` with `id` before the client request deadline |
| Poll interval | 2000 ms | `Retry-After` wins when present |
| Poll timeout | fast 150000, else 180000 ms | server deadline + 30000 |
| `maxRetries` | 2 | `rate_limit_exceeded` only; `retryUnavailable` adds `temporarily_unavailable` |
| Retry delay | `Retry-After`, else 1000 ms | |
| Retried requests | every retry is a new request; an accepted charged request is charged again | failures after admission are refunded; cancellations stay charged |

Timeout precedence, cancellation, retry budgets, and durable recovery are documented in the [TypeScript](ts/docs/behavior.md) and [Python](python/docs/behavior.md) behavior guides.

## Updating

1. Run `scripts/sync-openapi.sh` to fetch the [published OpenAPI document](https://www.arex-research.com/platform/docs/openapi.json), or pass a local file path or URL as its argument. Synchronization replaces `openapi/arex-v1.json` atomically; a failed fetch or copy leaves it intact.
2. Run `(cd ts && npm run generate:wire)` and `(cd python && uv run python scripts/generate_wire.py)`.
3. Review the contract and generated changes, adjust fixtures and mapping layers, then run both suites and generated-file freshness checks described in [CONTRIBUTING.md](CONTRIBUTING.md).
