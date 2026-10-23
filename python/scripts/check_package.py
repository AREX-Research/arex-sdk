"""Verify the Python wheel and sdist that would be released, as a consumer sees them.

For each artifact: its contents and metadata (name, version, Apache-2.0 license
expression and license file, py.typed, no stray files), a clean install of
exactly those bytes into a fresh virtualenv, a strict mypy run over a consumer
module against the installed package, and a public-API smoke run
(smoke_package.py) through the sync and async clients against a local server.
The wheel and the sdist must agree on name and version.

    python scripts/check_package.py [DIST_FILE ...] [--expected-version X.Y.Z]
                                    [--report FILE]

With no DIST_FILE the package is built first (`python -m build`) into a
temporary directory. Pass the wheel and the sdist to check files that were
already built, e.g. `dist/*`. Installing needs network access for httpx and,
for the sdist, the hatchling build backend. Type checking needs mypy importable
by the interpreter running this script (`uv run python scripts/check_package.py`).

--report writes JSON with the inputs (artifact paths and sha256), the command
to rerun the check and every step's result, even when a step fails.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from email.message import Message
from email.parser import Parser
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PACKAGE_ROOT = HERE.parent
FIXTURES = PACKAGE_ROOT.parent / "fixtures"
DISTRIBUTION = "arex-python-sdk"
LICENSE_HEADER = "Apache License"
# Files that must never ship: they signal an over-broad include.
FORBIDDEN_PARTS = {"tests", ".venv", "__pycache__", ".git", ".github", ".pytest_cache"}

CONSUMER = """\
import arex
from arex import (
    Arex, ArexApiError, AsyncArex, ContentsDocument, ContentsTier,
    ResearchRun, SearchResponse,
)

client = Arex("key", max_retries=1)
response: SearchResponse = client.search(
    "query",
    limit=1,
    published_after="2026-08-01T00:00:00Z",
    published_before="2026-09-01T00:00:00Z",
)
published_at: str | None = response.results[0].published_at
tier: ContentsTier = "flex"
document: ContentsDocument = client.contents("https://example.org/", tier=tier)


def answer(run: ResearchRun) -> str:
    return run.result.answer if run.result is not None else run.status


def failed(error: Exception) -> bool:
    return isinstance(error, ArexApiError)


async def extract() -> None:
    async with AsyncArex("key") as async_client:
        document: ContentsDocument = await async_client.contents("https://example.org/")
        content: str = document.content


client.search(1)  # type: ignore[arg-type]
client.research.create("query", mode="turbo")  # type: ignore[arg-type]
"""

results: list[dict[str, Any]] = []


def ensure(condition: object, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def step(name: str, body: Any) -> Any:
    try:
        detail = body()
    except Exception as exc:
        results.append({"name": name, "ok": False, "detail": str(exc)})
        print(f"FAIL {name}\n{exc}", file=sys.stderr)
        raise
    results.append({"name": name, "ok": True, **({"detail": detail} if detail else {})})
    print(f"ok   {name}")
    return detail


def run(command: list[str], **kwargs: Any) -> str:
    completed = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if completed.returncode != 0:
        raise RuntimeError(
            f"{' '.join(command)} exited {completed.returncode}\n"
            f"{completed.stdout}{completed.stderr}"
        )
    return completed.stdout


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_metadata(metadata: Message, expected_version: str | None) -> str:
    ensure(metadata["Name"] == DISTRIBUTION, f"Name is {metadata['Name']}")
    ensure(
        metadata["License-Expression"] == "Apache-2.0",
        f"License-Expression is {metadata['License-Expression']}",
    )
    ensure(
        "LICENSE" in (metadata.get_all("License-File") or []),
        "METADATA does not list License-File: LICENSE",
    )
    classifiers = metadata.get_all("Classifier") or []
    ensure(
        not [
            c for c in classifiers if c.startswith("License ::") and "Apache" not in c
        ],
        f"non-Apache license classifier: {classifiers}",
    )
    ensure(metadata["Requires-Python"] == ">=3.10", metadata["Requires-Python"])
    ensure(
        [r for r in metadata.get_all("Requires-Dist") or [] if r.startswith("httpx")],
        "httpx is not a declared dependency",
    )
    version = metadata["Version"]
    if expected_version is not None:
        ensure(
            version == expected_version, f"version {version} is not {expected_version}"
        )
    return str(version)


def check_wheel(path: Path, expected_version: str | None) -> str:
    with zipfile.ZipFile(path) as wheel:
        names = wheel.namelist()
        dist_info = {n.split("/")[0] for n in names if ".dist-info/" in n}
        ensure(len(dist_info) == 1, f"expected one .dist-info, found {dist_info}")
        info = dist_info.pop()
        for required in (
            "arex/__init__.py",
            "arex/py.typed",
            "arex/_wire.py",
            f"{info}/METADATA",
            f"{info}/RECORD",
            f"{info}/licenses/LICENSE",
        ):
            ensure(required in names, f"wheel is missing {required}")
        for name in names:
            ensure(
                name.startswith(("arex/", info + "/")),
                f"unexpected wheel member {name}",
            )
        ensure(
            LICENSE_HEADER in wheel.read(f"{info}/licenses/LICENSE").decode(),
            "wheel LICENSE is not the Apache License",
        )
        metadata = Parser().parsestr(wheel.read(f"{info}/METADATA").decode())
    return check_metadata(metadata, expected_version)


def check_sdist(path: Path, expected_version: str | None) -> str:
    with tarfile.open(path) as sdist:
        names = sdist.getnames()
        roots = {name.split("/")[0] for name in names}
        ensure(len(roots) == 1, f"expected one root directory, found {roots}")
        root = roots.pop()
        for required in (
            "PKG-INFO",
            "pyproject.toml",
            "README.md",
            "LICENSE",
            "src/arex/__init__.py",
            "src/arex/py.typed",
            "src/arex/_wire.py",
        ):
            ensure(f"{root}/{required}" in names, f"sdist is missing {required}")
        for name in names:
            stray = FORBIDDEN_PARTS.intersection(Path(name).parts)
            ensure(not stray, f"sdist contains {name}")
        license_file = sdist.extractfile(f"{root}/LICENSE")
        ensure(license_file is not None, "sdist LICENSE is unreadable")
        ensure(
            LICENSE_HEADER in license_file.read().decode(),  # type: ignore[union-attr]
            "sdist LICENSE is not the Apache License",
        )
        pkg_info = sdist.extractfile(f"{root}/PKG-INFO")
        ensure(pkg_info is not None, "sdist PKG-INFO is unreadable")
        metadata = Parser().parsestr(pkg_info.read().decode())  # type: ignore[union-attr]
    return check_metadata(metadata, expected_version)


def install_and_smoke(artifact: Path, work: Path, version: str) -> dict[str, Any]:
    kind = "wheel" if artifact.suffix == ".whl" else "sdist"
    env_dir = work / f"venv-{kind}"
    # The CLI, not venv.EnvBuilder: in-process creation from inside a uv-created
    # virtualenv yields an interpreter that cannot start.
    run([sys.executable, "-m", "venv", str(env_dir)])
    bindir = env_dir / ("Scripts" if os.name == "nt" else "bin")
    python = str(bindir / ("python.exe" if os.name == "nt" else "python"))
    run(
        [
            python,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--quiet",
            str(artifact),
        ]
    )
    # An empty directory: nothing but the installed distribution can be imported.
    neutral = work / f"run-{kind}"
    neutral.mkdir()
    shutil.copy(HERE / "smoke_package.py", neutral / "smoke.py")
    (neutral / "consumer.py").write_text(CONSUMER, encoding="utf-8")
    ensure(importlib.util.find_spec("mypy"), "mypy is not importable: use `uv run`")
    run(
        [
            sys.executable, "-m", "mypy", "--strict", "--python-executable", python,
            "--cache-dir", os.devnull, "consumer.py",
        ],
        cwd=neutral,
    )  # fmt: skip
    env = {k: v for k, v in os.environ.items() if k != "AREX_API_KEY"}
    stdout = run(
        [python, "-I", "smoke.py", "--version", version, "--fixtures", str(FIXTURES)],
        cwd=neutral,
        env=env,
    )
    summary: dict[str, Any] = json.loads(stdout.strip().splitlines()[-1])
    ensure(summary["checks"], "smoke ran no checks")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("artifacts", nargs="*", type=Path)
    parser.add_argument("--expected-version")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    work = Path(tempfile.mkdtemp(prefix="arex-py-package-"))
    report: dict[str, Any] = {
        "inputs": {"python": sys.version.split()[0], "packageRoot": str(PACKAGE_ROOT)},
        "rerun": {
            "cwd": str(Path.cwd()),
            "argv": [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
        },
        "results": results,
    }
    passed = False
    try:
        artifacts = [path.resolve() for path in args.artifacts]
        if not artifacts:

            def build() -> str:
                out = work / "dist"
                run(
                    [sys.executable, "-m", "build", "--outdir", str(out)],
                    cwd=PACKAGE_ROOT,
                )
                artifacts.extend(sorted(out.iterdir()))
                return ", ".join(path.name for path in artifacts)

            step("python -m build builds wheel and sdist from the checkout", build)
        wheels = [a for a in artifacts if a.suffix == ".whl"]
        sdists = [a for a in artifacts if a.name.endswith(".tar.gz")]
        ensure(
            len(wheels) == 1 and len(sdists) == 1 and len(artifacts) == 2,
            f"expected one wheel and one sdist, got {[a.name for a in artifacts]}",
        )
        wheel, sdist = wheels[0], sdists[0]
        report["inputs"]["artifacts"] = [
            {"path": str(a), "sha256": sha256(a), "bytes": a.stat().st_size}
            for a in (wheel, sdist)
        ]
        for a in report["inputs"]["artifacts"]:
            print(f"checking {a['path']} (sha256 {a['sha256']})")

        wheel_version = step(
            "wheel contents and metadata",
            lambda: check_wheel(wheel, args.expected_version),
        )
        sdist_version = step(
            "sdist contents and metadata",
            lambda: check_sdist(sdist, args.expected_version),
        )
        step(
            "wheel and sdist agree on version",
            lambda: ensure(
                wheel_version == sdist_version,
                f"wheel is {wheel_version}, sdist is {sdist_version}",
            ),
        )
        for artifact in (wheel, sdist):
            kind = "wheel" if artifact is wheel else "sdist"
            step(
                f"clean install, type-check and public API smoke from the {kind}",
                lambda artifact=artifact: install_and_smoke(
                    artifact, work, wheel_version
                ),
            )
        passed = True
    except Exception as exc:
        print(f"package verification failed: {exc}", file=sys.stderr)
        passed = False
    finally:
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(
                json.dumps({**report, "passed": passed}, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"report: {args.report}")
        shutil.rmtree(work, ignore_errors=True)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
