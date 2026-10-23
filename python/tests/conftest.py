"""Shared fixtures: a fake clock, and the opt-in rule for the live suite."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest


class FakeClock:
    """Sleeping advances `now`; handlers may `advance` it to simulate slow I/O."""

    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.advance(seconds)

    async def async_sleep(self, seconds: float) -> None:
        self.sleep(seconds)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    fake = FakeClock()
    module = SimpleNamespace(monotonic=fake.monotonic, sleep=fake.sleep)
    monkeypatch.setattr("arex._poll.time", module)
    monkeypatch.setattr("arex._transport.time", module)
    monkeypatch.setattr("asyncio.sleep", fake.async_sleep)
    return fake


@pytest.fixture
def sleeps(clock: FakeClock) -> list[float]:
    return clock.sleeps


_LIVE = Path(__file__).resolve().parent / "live"


def pytest_ignore_collect(collection_path: Path, config: pytest.Config) -> bool | None:
    """Live tests call the real service, so require an explicit command-line path."""
    if _LIVE not in (collection_path, *collection_path.parents):
        return None
    for arg in config.invocation_params.args:
        named = (config.invocation_params.dir / str(arg).split("::")[0]).resolve()
        if _LIVE in (named, *named.parents):
            return False
    return True
