---
"@arex-research/ts-sdk": minor
---

Stop enforcing server-owned value limits on the client. Query and URL lengths, `limit`, `livecrawlTimeoutMs` and `maxCharacters` ranges, and the `tier` and `mode` values are now checked by the server, whose `invalid_request` answer surfaces as `InvalidRequestError` with `status: 400` and `param`, so a server limit change no longer needs an SDK release. Argument types, URL shape, publication timestamps and timeouts are still checked before sending. The Python SDK drops `DEFAULT_CONTENTS_MAX_CHARACTERS`.
