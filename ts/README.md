# @arex-research/ts-sdk

TypeScript client for the AREX public API v1. ESM only, Node >= 20 or Bun, no runtime dependencies.

Install from npm:

```bash
npm install @arex-research/ts-sdk
```

Or download the `.tgz` from [GitHub Releases](https://github.com/AREX-Research/arex-sdk/releases/latest) and run `npm install ./arex-research-ts-sdk-*.tgz`.

```ts
import { Arex } from "@arex-research/ts-sdk";

const arex = new Arex(); // reads AREX_API_KEY

const { results } = await arex.search("how are AI agents evaluated", { limit: 5 });
for (const { url } of results) {
  const page = await arex.contents(url, { maxCharacters: 4000 });
}
const run = await arex.research.run("Compare agent evaluation benchmarks", { mode: "fast" });
console.log(run.result.answer);
```

- [API reference](https://github.com/AREX-Research/arex-sdk/blob/main/ts/docs/api.md): options, result shapes, errors, exports.
- [Behavior](https://github.com/AREX-Research/arex-sdk/blob/main/ts/docs/behavior.md): deadlines, retries, polling, and recovery.
- [Examples](https://github.com/AREX-Research/arex-sdk/tree/main/ts/examples): runnable scripts.
- [Changelog](https://github.com/AREX-Research/arex-sdk/blob/main/ts/CHANGELOG.md): release history.

Keep API keys server-side. Retries are new requests; the server does not replay earlier responses.

[Apache License 2.0](https://github.com/AREX-Research/arex-sdk/blob/main/LICENSE).
