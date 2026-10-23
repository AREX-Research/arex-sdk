# arex-python-sdk

## 1.0.0

Initial release of the Python client for the AREX public API.

- Search the web, read page Contents, and run asynchronous Research against the AREX public API v1.
- Research lifecycle: `research.create`, `get`, `cancel`, `delete`, `wait`, and `run`, which creates a run and returns it once complete.
- The client reads the key from `AREX_API_KEY`, validates options before sending, applies per-call deadlines, and retries rate-limited requests.
- Typed errors carry the API error code, HTTP status, and request id.
- Forward compatible: new Research modes, statuses, and failure codes pass through unchanged, and an unfamiliar status is treated as still in progress.
- Synchronous `Arex` and asynchronous `AsyncArex` clients with the same calls. Python >= 3.10; the only dependency is `httpx`.
