# arex-python-sdk

Python client for the AREX public API, synchronous and asynchronous. Python >= 3.10; the only dependency is `httpx`.

Install from PyPI:

```bash
pip install arex-python-sdk
```

Or download the `.whl` from [GitHub Releases](https://github.com/AREX-Research/arex-sdk/releases/latest) and run `pip install ./arex_python_sdk-*.whl`.

```python
from arex import Arex

with Arex() as arex:  # reads AREX_API_KEY
    search = arex.search("how are AI agents evaluated", limit=5)
    for item in search.results:
        page = arex.contents(item.url, max_characters=4000)
    run = arex.research.run("Compare agent evaluation benchmarks", mode="fast")
    assert run.result is not None  # always set once run() returns
    print(run.result.answer)
```

`AsyncArex` mirrors every call as a coroutine under `async with`.

The SDK follows the checked-in v1 OpenAPI contract. Keep API keys server-side.

- [API reference](https://github.com/AREX-Research/arex-sdk/blob/main/python/docs/api.md): options, models, errors, exports.
- [Behavior](https://github.com/AREX-Research/arex-sdk/blob/main/python/docs/behavior.md): deadlines, retries, polling, and recovery.
- [Examples](https://github.com/AREX-Research/arex-sdk/tree/main/python/examples): runnable scripts.
- [Changelog](https://github.com/AREX-Research/arex-sdk/blob/main/python/CHANGELOG.md): release history.

[Apache License 2.0](https://github.com/AREX-Research/arex-sdk/blob/main/LICENSE).
