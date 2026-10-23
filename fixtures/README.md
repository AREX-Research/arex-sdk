# Shared wire fixtures

Each file is one recorded HTTP response on the v1 contract in `../openapi/arex-v1.json`:
`{ "status": number, "headers": object, "body": JSON | null }`. Both `ts/tests` and `python/tests` load these
files, so a contract change breaks both suites at once. Every error body is the v1 envelope
`{error:{code,message,retryable,request_id,...}}`.
