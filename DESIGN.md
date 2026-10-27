# AREX SDK design

The repository contains two SDKs for the same public API: TypeScript (`Arex`) and Python (`Arex`, `AsyncArex`). They expose Search, Contents, and the Research lifecycle.

## Where to make changes

| Concern | TypeScript | Python |
| --- | --- | --- |
| Public calls and request mapping | `ts/src/client.ts`, `resources/research.ts` | `python/src/arex/client.py`, `async_client.py`, `research.py` |
| HTTP, authentication, retries, request budgets | `ts/src/internal/http.ts` | `python/src/arex/_transport.py` |
| Poll deadlines and cancellation | `ts/src/internal/poll.ts` | `python/src/arex/_poll.py` |
| Input validation | `ts/src/validate.ts` | `python/src/arex/_validate.py` |
| Result models and response validation | `ts/src/types.ts`, client/resource mapping | `python/src/arex/models.py` |
| Error mapping | `ts/src/errors.ts` | `python/src/arex/errors.py` |
| Generated wire contract | `ts/src/wire.ts` | `python/src/arex/_wire.py` |

The TypeScript transport seam is WHATWG `fetch`; the Python transport seam is `httpx`. Inject these for proxies, connection pooling, or tests. Do not introduce a second plugin layer. SDK-owned Python clients are closed by their context managers; injected clients remain caller-owned.

Keep protocol handling in the transport module and research state transitions in the research module. Before the network, check only what building a request needs (argument types, URL shape, SDK-owned options such as timeouts and poll intervals); never enforce server-owned value limits, which the server reports as `invalid_request` and can change without an SDK release. Validate untrusted responses while mapping them into public models. A cast to a generated wire type is not runtime validation.

## Sources of truth

- `openapi/arex-v1.json` owns server fields, limits, error codes, and headers; the SDK reads limits from it for documentation and response validation only, never to reject a request. It is checked in so contributors can build without fetching external sources.
- [CONTRACT.md](CONTRACT.md) records SDK-owned defaults and the contract update procedure.
- `ts/docs/api.md` and `python/docs/api.md` describe the public interface; `docs/behavior.md` in each package explains operational behavior and recovery.
- Public types live in source, not in a second hand-maintained inventory here.
- `fixtures/` holds response examples shared by both language suites. Generator freshness checks and behavioral tests serve different purposes; a fixture alone is not full schema validation.

## Interface conventions

Use camelCase in TypeScript and snake_case in Python; wire JSON remains snake_case. Operational rules belong in the [TypeScript](ts/docs/behavior.md) and [Python](python/docs/behavior.md) behavior guides, with shared defaults in [CONTRACT.md](CONTRACT.md). Keep this guide focused on module responsibilities rather than duplicating those rules.

The packages share behavior, not implementation code. Keep parity through equivalent observable scenarios: retry budgets, cancellation, retrieval results, invalid responses, and terminal research states. Prefer strengthening existing behavior coverage to asserting copies of generated constants.

## Contributor and maintainer workflows

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and contract updates; [RELEASING.md](RELEASING.md) for package publication; and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

First-party source and packages use Apache License 2.0. Root and package-local `LICENSE` files carry identical text so each distribution is self-contained. Third-party dependency licenses remain unchanged.
