# Contributing

## Setup

Install Node >= 20, Python >= 3.10, and [uv](https://docs.astral.sh/uv/). Bun is needed for its package-consumer check. From the repository root:

```sh
(cd ts && npm ci)
(cd python && uv sync --frozen)
```

No API key is needed for the ordinary checks. Live suites require explicit credentials and can spend credits; do not run them as ordinary contributor checks. Keep secrets out of source, fixtures, and reports.

Read [DESIGN.md](DESIGN.md) for module ownership and conventions. Keep TypeScript and Python behavior aligned through equivalent observable scenarios rather than shared implementation code.

## Checks

From the repository root:

```sh
(cd ts && npm run lint && npm run typecheck && npm test && npm run check:generated)
(cd python && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest && uv run python scripts/generate_wire.py --check)
```

After implementation changes, exercise the packages consumers actually install:

```sh
(cd ts && npm run check:package -- --report /tmp/arex-ts-package.json)
(cd ts && npm run check:package -- --runtime bun --report /tmp/arex-bun-package.json)
(cd python && uv run python scripts/check_package.py --report /tmp/arex-python-package.json)
```

These commands build, inspect, install in isolation, and exercise the public APIs against a local HTTP server without credentials. Node and Python checks also compile/type-check consumer code. Reports retain inputs, checksums, results, and the rerun working directory and argument vector. For release verification, pass the already-built tarball or wheel and sdist to check the exact bytes being released.

## Contract updates

Follow [CONTRACT.md](CONTRACT.md#updating): use `scripts/sync-openapi.sh` to fetch the published document or supply a local file or URL, regenerate both wire modules, then update affected mappings and fixtures. Do not hand-edit generated files. Run the checks above for both packages, including generated-file freshness checks, and review changes to the published interface and behavior guides.

Keep user-facing examples consistent with the typed APIs. Python result models are frozen dataclasses; use `dataclasses.asdict` when a dictionary is needed.

## Review and releases

Submit focused changes with observable behavior coverage where needed. Report the checks run and any checks not exercised. Update affected API or behavior guides rather than duplicating implementation details. Package versioning and publication are documented in [RELEASING.md](RELEASING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
