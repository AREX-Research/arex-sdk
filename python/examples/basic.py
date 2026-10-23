"""Search and contents with the synchronous client.

Run with: AREX_API_KEY=sk_arex_... uv run python examples/basic.py
"""

from arex import Arex


def main() -> None:
    with Arex() as arex:
        results = arex.search("AI agent evaluation", limit=3)
        for result in results.results:
            print(f"{result.title}\n  {result.url}")

        document = arex.contents(results.results[0].url, max_characters=2000)
        print(f"\n{document.title or document.url}")
        print(document.content[:280])


if __name__ == "__main__":
    main()
