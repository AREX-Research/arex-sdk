# Releasing the SDKs

## Prepare a version

Both packages use one release version. Use Changesets for the TypeScript version and changelog, then match the Python project version and changelog and refresh both lockfiles. Python reads its runtime version from installed metadata. Published versions are immutable; the next release must be newer than the latest published version.

Before release, commit every reviewed file, obtain independent review, and run CI. See [CONTRIBUTING.md](CONTRIBUTING.md) for contributor and package-consumer checks.

## Trusted publishers (one-time setup)

Both registries trust the same GitHub identity:

| Setting | Value |
| --- | --- |
| Owner | `AREX-Research` |
| Repository | `arex-sdk` |
| Workflow filename | `build-release-artifacts.yml` |
| Environment | `release` |

Configure this identity in [npm package settings](https://www.npmjs.com/package/@arex-research/ts-sdk/access) (allow direct `npm publish`) and [PyPI publishing settings](https://pypi.org/manage/project/arex-python-sdk/settings/publishing/). In GitHub, restrict the `release` environment to the `main` branch, not tags. Configure required reviewers where supported, and keep workflow changes under review.

No npm or PyPI token secrets are needed for the hosted workflow. After the first successful OIDC release, revoke unused publishing tokens. npm provenance requires a public source repository.

## Run a hosted release

The **Release SDKs** workflow builds once and tests the exact npm tarball, wheel and sdist across its runtime matrix. It only runs from `main`, building the dispatch's immutable commit so source and workflow identity match. Build/test jobs have no publishing permission. Separate registry jobs use OIDC, verify checksums, and never check out or execute package source. GitHub Release creation follows successful publication to both registries.

After merging the reviewed changes, first verify without publishing:

```sh
gh workflow run build-release-artifacts.yml --ref main -f publish=false
```

For a new, reviewed version, run the same workflow with `-f publish=true`. This publishes to **all three destinations**; it is not a GitHub-only release. Inspect the run's commit and package versions before approving any environment gate. Verification reports are retained for 30 days; package artifacts for 7 days.

Publication across services is not atomic. If a registry job fails, use **Re-run failed jobs** on that same run while artifacts remain available: successful jobs stay complete and the original bytes are reused. PyPI skips an already-uploaded distribution to recover a partial wheel/sdist upload. Do not start a fresh run or rebuild that version. If an upload succeeded but its job reported failure, compare the registry files with the run's checksums before recovery; never replace published bytes. Once a GitHub Release exists, its version cannot be released again.

## Manual local fallback

GitHub Actions is the preferred release procedure. When the hosted workflow cannot be used, run `scripts/release-local.sh --no-publish` from a clean `main` matching `origin/main`. Install Git, GitHub CLI (authenticated), Docker, curl, and uv **0.12.21** first. The script downloads checksum-verified Node **22.23.3**, installs Python **3.12.13**, and runs the release workflow's build commands in a detached worktree. Keep its commands and runtime matrix aligned with `build-release-artifacts.yml` when changing the workflow.

The gitignored `.release-local/<version>-<commit>/` directory retains the exact npm tarball, Python wheel and sdist, `SHA256SUMS`, identical release notes, per-check logs, consumer reports, and `report.json`. Official Node 20/22/24, Bun latest, and Python 3.10/3.12/3.13 containers verify the mounted read-only artifacts and their checksums on Linux arm64 and amd64. A platform Docker cannot execute is explicitly reported as **not verified locally**; review that limitation before publishing. Existing run directories are never overwritten; move a check-only run aside explicitly before another run.

To publish a new reviewed version, omit `--no-publish`. The same invocation builds and checks once, rejects existing releases/tags/registry versions, then requires typing the version before publishing those exact files without rebuilding. Use your existing npm login (`npm login` if needed); npm requests its own OTP. Enter the PyPI token at the hidden prompt; it is passed only through `UV_PUBLISH_TOKEN`, never saved. The GitHub release uses the checked assets, notes and source commit. No publication occurs in check-only mode. If publication partially succeeds, retain the run directory and recover using its checked files; do not rebuild or replace an already-published version.
