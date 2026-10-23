"""One-call research with the synchronous client, including recovery.

Run with: AREX_API_KEY=sk_arex_... uv run python examples/research.py

The sync client checks `timeout_ms` between attempts and after responses;
use `AsyncArex` for a hard wall-clock limit (see docs/behavior.md).
"""

import os
import sys

from arex import Arex, ArexTimeoutError, ResearchRunFailedError

QUERY = "How are autonomous coding agents evaluated in 2026?"


def main() -> None:
    with Arex(base_url=os.environ.get("AREX_BASE_URL")) as arex:
        try:
            run = arex.research.run(QUERY, mode="fast")
        except ResearchRunFailedError as error:
            print(
                f"run {error.run.id} failed, error={error.run.error}", file=sys.stderr
            )
            raise SystemExit(1) from error
        except ArexTimeoutError as error:
            if error.phase != "poll" or error.run_id is None:
                raise  # unknown outcome: a retry could create another run
            # The run keeps going server-side; wait(run_id) resumes polling.
            print(f"still running after {error.timeout_ms} ms: {error.run_id}")
            run = arex.research.wait(error.run_id)

        assert run.result is not None
        print(run.result.answer)
        for source in run.result.sources:
            print(f"- {source.title}: {source.url}")


if __name__ == "__main__":
    main()
