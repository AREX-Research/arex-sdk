"""Smoke tests against the real AREX API.

Run with `AREX_API_KEY=... uv run pytest tests/live` (optionally `AREX_API_BASE`).
These calls use the real service. Plain `pytest` never collects this directory; only a
command-line path naming it does (see `tests/conftest.py`).
"""

from __future__ import annotations

import os

import pytest

from arex import Arex, AsyncArex

pytestmark = pytest.mark.skipif(
    not os.environ.get("AREX_API_KEY"), reason="AREX_API_KEY is not set"
)

BASE_URL = os.environ.get("AREX_API_BASE")


def make_client() -> Arex:
    return Arex(base_url=BASE_URL)


def test_search_returns_results() -> None:
    with make_client() as arex:
        response = arex.search("AI agent evaluation", limit=3)

    assert len(response.results) <= 3
    assert all(result.url.startswith("http") for result in response.results)


def test_contents_extracts_content() -> None:
    with make_client() as arex:
        document = arex.contents("https://example.com/", max_characters=2000)

    assert document.content


def test_research_run_completes() -> None:
    with make_client() as arex:
        run = arex.research.run("What is retrieval augmented generation?", mode="fast")

    assert run.status == "completed"
    assert run.result is not None
    assert run.result.answer


async def test_async_search_returns_results() -> None:
    async with AsyncArex(base_url=BASE_URL) as arex:
        response = await arex.search("AI agent evaluation", limit=3)

    assert len(response.results) <= 3
    assert all(result.url.startswith("http") for result in response.results)
