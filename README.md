# AREX SDK

English | [中文](./README.zh-CN.md)

Official SDKs for the AREX public API: web Search, page Contents, asynchronous Research.

## Install

### TypeScript

Node >= 20 or Bun. [Documentation](./ts/README.md).

From npm:

```sh
npm install @arex-research/ts-sdk
```

Or download the `.tgz` from [GitHub Releases](https://github.com/AREX-Research/arex-sdk/releases/latest):

```sh
npm install ./arex-research-ts-sdk-*.tgz
```

### Python

Python >= 3.10. [Documentation](./python/README.md).

From PyPI:

```sh
pip install arex-python-sdk
```

Or download the `.whl` from [GitHub Releases](https://github.com/AREX-Research/arex-sdk/releases/latest):

```sh
pip install ./arex_python_sdk-*.whl
```

## Usage

Both clients read the key from `AREX_API_KEY` and expose the same calls: `search`, `contents`, `research.create/get/cancel/delete/wait/run`. Python provides both synchronous `Arex` and asynchronous `AsyncArex`.

```ts
import { Arex } from "@arex-research/ts-sdk";

const arex = new Arex();
const { results } = await arex.search("recent advances in AI agents", { limit: 5 });
const run = await arex.research.run("Compare approaches to AI agent evaluation");
```

```py
from arex import Arex

with Arex() as arex:
    results = arex.search("recent advances in AI agents", limit=5)
    run = arex.research.run("Compare approaches to AI agent evaluation")
```

Keys are secrets: use the SDKs from server-side code only.

Maintainers: [DESIGN.md](./DESIGN.md) explains module layout and conventions; [CONTRACT.md](./CONTRACT.md) records SDK policy; [CONTRIBUTING.md](./CONTRIBUTING.md) covers setup, checks, and contract updates; [RELEASING.md](./RELEASING.md) covers publication; [SECURITY.md](./SECURITY.md) explains private vulnerability reporting. [fixtures/](./fixtures) holds responses shared by both test suites.

[Apache License 2.0](./LICENSE).
