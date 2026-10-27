"""Smoke test for the INSTALLED Python artifact (wheel or sdist).

check_package.py installs the artifact into a clean virtualenv and runs this file
there with `python -I` from an empty directory, so `arex` can only resolve to
site-packages. Calls go through the public sync and async clients to a local HTTP
server that replays the shared wire fixtures; nothing reaches the live API.

    python -I smoke_package.py --version X.Y.Z --fixtures DIR
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
import sys
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

DISTRIBUTION = "arex-python-sdk"
API_KEY = "sk_arex_" + "a" * 32
RUN_ID = "0f7c3b3e-2d3a-4b7e-9a1c-6f0d2b8c4e5a"

parser = argparse.ArgumentParser()
parser.add_argument("--version", required=True)
parser.add_argument("--fixtures", required=True, type=Path)
args = parser.parse_args()

# A local server must never be routed through a proxy configured on the runner.
os.environ["NO_PROXY"] = "127.0.0.1"
os.environ.pop("AREX_API_KEY", None)

checks: list[str] = []
requests: list[dict[str, Any]] = []
routes: dict[str, list[str]] = {}


def script(scenario: dict[str, list[str]]) -> None:
    """Each route replays its fixtures in order and repeats the last one."""
    routes.clear()
    routes.update({route: list(names) for route, names in scenario.items()})
    requests.clear()


class Handler(BaseHTTPRequestHandler):
    def _serve(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        text = self.rfile.read(length).decode() if length else ""
        route = f"{self.command} {self.path}"
        requests.append(
            {
                "route": route,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": json.loads(text) if text else None,
            }
        )
        queue = routes.get(route)
        if not queue:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        name = queue.pop(0) if len(queue) > 1 else queue[0]
        fixture = json.loads((args.fixtures / f"{name}.json").read_text())
        payload = (
            b"" if fixture["body"] is None else json.dumps(fixture["body"]).encode()
        )
        self.send_response(fixture["status"])
        for key, value in fixture["headers"].items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_DELETE = _serve

    def log_message(self, format: str, *log_args: Any) -> None:
        pass


def check(name: str, body: Callable[[], None]) -> None:
    body()
    checks.append(name)


def expect_raises(error_type: type[BaseException], call: Callable[[], Any]) -> Any:
    try:
        call()
    except error_type as exc:
        return exc
    raise AssertionError(f"expected {error_type.__name__}")


def main(base_url: str) -> None:
    import arex
    from arex import (
        Arex,
        ArexApiError,
        ArexError,
        AsyncArex,
        AuthenticationError,
        InvalidRequestError,
    )

    package_dir = Path(arex.__file__).resolve().parent

    def installed_identity() -> None:
        assert "site-packages" in package_dir.parts, f"imported from {package_dir}"
        assert (package_dir / "py.typed").is_file(), "py.typed is not installed"
        dist = importlib.metadata.distribution(DISTRIBUTION)
        assert dist.version == args.version, dist.version
        assert arex.__version__ == args.version, arex.__version__
        assert dist.metadata["License-Expression"] == "Apache-2.0"
        licenses = [path for path in dist.files or [] if path.name == "LICENSE"]
        assert licenses, "installed distribution has no LICENSE file"
        assert "Apache License" in licenses[0].read_text(encoding="utf-8")

    check("installed distribution, version, license and py.typed", installed_identity)

    def exports() -> None:
        for name in arex.__all__:
            assert hasattr(arex, name), f"__all__ lists missing name {name}"
        for name in (
            "Arex",
            "AsyncArex",
            "ArexError",
            "ArexApiError",
            "AuthenticationError",
            "RateLimitError",
            "is_arex_api_key",
            "DEFAULT_BASE_URL",
            "SearchResponse",
            "ContentsDocument",
            "ContentsTier",
            "CONTENTS_TIERS",
            "DEFAULT_CONTENTS_TIER",
            "CONTENTS_AUTO_TIMEOUT_MS",
            "CONTENTS_FLEX_TIMEOUT_MS",
            "ResearchRun",
        ):
            assert name in arex.__all__, f"{name} is not exported"
        for name in (
            "Credits",
            "CreditWindow",
            "CreditWeek",
            "CreditUsage",
            "USAGE_TIMEOUT_MS",
            "DEFAULT_CONTENTS_MAX_CHARACTERS",
        ):
            assert not hasattr(arex, name), f"{name} remains public"
        assert not hasattr(Arex, "usage")
        assert not hasattr(AsyncArex, "usage")
        assert arex.is_arex_api_key(API_KEY)
        expect_raises(ValueError, lambda: Arex())

    check("public exports", exports)

    arex_client = Arex(API_KEY, base_url=base_url)

    def search() -> None:
        script({"POST /v1/search": ["search.ok"]})
        response = arex_client.search(
            "agent evaluation",
            limit=2,
            published_after="2026-08-01T00:00:00Z",
            published_before="2026-09-01T00:00:00Z",
        )
        assert len(response.results) == 2
        assert response.results[0].snippet == "A survey of evaluation methods."
        assert response.results[0].published_at == "2026-09-01T00:00:00.000Z"
        assert response.results[1].snippet is None
        assert response.results[1].published_at is None
        assert not hasattr(response, "credits")
        request = requests[0]
        assert request["headers"]["authorization"] == f"Bearer {API_KEY}"
        assert request["body"] == {
            "query": "agent evaluation",
            "limit": 2,
            "published_after": "2026-08-01T00:00:00Z",
            "published_before": "2026-09-01T00:00:00Z",
        }

    check("search", search)

    def contents() -> None:
        script({"POST /v1/contents": ["contents.ok"]})
        page = arex_client.contents("https://example.org/agents", max_characters=4000)
        assert page.content == "Body text." and page.truncated is False
        assert page.published_at == "2026-09-01T00:00:00.000Z"
        assert not hasattr(page, "credits")
        assert requests[0]["body"] == {
            "url": "https://example.org/agents",
            "max_characters": 4000,
        }

    check("contents", contents)

    research_scenario = {
        "POST /v1/research": ["research.create.fast"],
        f"GET /v1/research/{RUN_ID}": [
            "research.get.running",
            "research.get.completed",
        ],
    }

    def research() -> None:
        script(research_scenario)
        run = arex_client.research.run(
            "Compare agent evaluation benchmarks",
            mode="fast",
            poll_interval_ms=10,
        )
        assert run.status == "completed"
        assert (
            run.result is not None
            and run.result.answer == "Agents are evaluated by ..."
        )
        assert not hasattr(run, "credits")
        create, *polls = requests
        assert create["route"] == "POST /v1/research"
        assert create["body"] == {
            "query": "Compare agent evaluation benchmarks",
            "mode": "fast",
        }
        assert len(polls) == 2

    check("research.run polls to a completed run", research)

    def api_error() -> None:
        script({"POST /v1/search": ["error.unauthorized"]})
        error = expect_raises(AuthenticationError, lambda: arex_client.search("agents"))
        assert isinstance(error, ArexApiError) and isinstance(error, ArexError)
        assert error.code == "unauthorized" and error.status == 401

    check("API errors map onto the typed hierarchy", api_error)

    def retry() -> None:
        script({"POST /v1/search": ["error.rate-limit", "search.ok"]})
        response = arex_client.search("agent evaluation")
        assert len(response.results) == 2 and len(requests) == 2

    check("a rate limit is retried until the call succeeds", retry)

    def validation() -> None:
        script({"POST /v1/search": ["search.ok"]})
        expect_raises(
            InvalidRequestError,
            lambda: arex_client.search("agents", limit=1.5),  # type: ignore[arg-type]
        )
        assert not requests

    check("client-side validation fails before any request", validation)
    arex_client.close()

    async def async_checks() -> None:
        async with AsyncArex(API_KEY, base_url=base_url) as client:
            script({"POST /v1/search": ["error.rate-limit", "search.ok"]})
            response = await client.search("agent evaluation")
            assert len(response.results) == 2 and len(requests) == 2

            script({"POST /v1/contents": ["contents.ok"]})
            page = await client.contents("https://example.org/agents")
            assert page.content == "Body text."
            assert requests[0]["body"] == {"url": "https://example.org/agents"}

            script(research_scenario)
            run = await client.research.run(
                "Compare agent evaluation benchmarks", mode="fast", poll_interval_ms=10
            )
            assert run.result is not None and run.result.answer.startswith("Agents")

            script({"POST /v1/search": ["error.unauthorized"]})
            try:
                await client.search("agents")
            except AuthenticationError as exc:
                assert exc.status == 401
            else:
                raise AssertionError("expected AuthenticationError")

    check(
        "async client: retry, contents, research.run and errors",
        lambda: asyncio.run(async_checks()),
    )


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    main(f"http://127.0.0.1:{server.server_address[1]}")
finally:
    server.shutdown()
    server.server_close()

print(
    json.dumps(
        {
            "python": sys.version.split()[0],
            "distribution": DISTRIBUTION,
            "version": args.version,
            "checks": checks,
        }
    )
)
