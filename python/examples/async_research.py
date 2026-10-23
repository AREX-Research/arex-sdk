"""Two concurrent research runs with the asynchronous client.

Run with: AREX_API_KEY=sk_arex_... uv run python examples/async_research.py
"""

import asyncio

from arex import AsyncArex


async def main() -> None:
    async with AsyncArex() as arex:
        runs = await asyncio.gather(
            arex.research.run("How are coding agents evaluated?", mode="fast"),
            arex.research.run("What is retrieval augmented generation?", mode="fast"),
        )

    for run in runs:
        assert run.result is not None
        print(f"{run.id}: {run.result.answer[:200]}")


if __name__ == "__main__":
    asyncio.run(main())
