#!/usr/bin/env bash
# Keep commands and runtime matrices aligned with build-release-artifacts.yml.
# Container commands deliberately expand inside Docker, not on the host.
# Release notes retain the workflow literal typography.
# shellcheck disable=SC2016,SC1112
set +x
set -euo pipefail
# Match the hosted Linux runner’s byte ordering in SHA256SUMS.
export LC_ALL=C

printf '\n%s\n%s\n\n' \
  'WARNING: GitHub Actions Release SDKs is the preferred release procedure.' \
  'This script is a manual fallback when the hosted workflow cannot be used.'

publish=true
case "${1:-}" in
  --no-publish) publish=false ;;
  '') ;;
  *) echo 'Usage: scripts/release-local.sh [--no-publish]' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Too many arguments' >&2; exit 2; }
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
repo=AREX-Research/arex-sdk
node_version=22.23.3
python_version=3.12.13
uv_version=0.12.21
run_dir=
worktree=

fail() { echo "ERROR: $*" >&2; exit 1; }
for command in git uv gh curl docker shasum tar uname; do
  command -v "$command" >/dev/null || fail "Install $command before running this fallback."
done
[[ $(git branch --show-current) == main ]] || fail 'Run from main.'
[[ -z $(git status --porcelain) ]] || fail 'Commit or remove all worktree changes first.'
git fetch origin main --tags
sha=$(git rev-parse HEAD)
[[ $sha == "$(git rev-parse origin/main)" ]] || fail 'main must match origin/main exactly.'
[[ $(uv --version) == "uv $uv_version"* ]] || fail "Install uv $uv_version (the pinned local build tool)."
case $(uname -s) in Darwin) host_os=darwin ;; Linux) host_os=linux ;; *) fail "Unsupported host OS." ;; esac
case $(uname -m) in arm64|aarch64) host_arch=arm64 ;; x86_64) host_arch=x64 ;; *) fail "Unsupported host architecture." ;; esac
node_archive="node-v$node_version-$host_os-$host_arch.tar.gz"
node_cache="$root/.release-local/tools/node-$node_version-$host_os-$host_arch"
mkdir -p "$node_cache"
if [[ ! -x $node_cache/bin/node ]]; then
  curl --fail --location "https://nodejs.org/dist/v$node_version/$node_archive" --output "$node_cache/$node_archive"
  curl --fail --location "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" --output "$node_cache/SHASUMS256.txt"
  while read -r hash filename; do
    if [[ $filename == "$node_archive" ]]; then printf "%s  %s\n" "$hash" "$filename" > "$node_cache/archive.sha256"; fi
  done < "$node_cache/SHASUMS256.txt"
  [[ -s $node_cache/archive.sha256 ]] || fail "Node archive is absent from the official checksum manifest."
  (cd "$node_cache" && shasum -a 256 --check archive.sha256 && tar -xzf "$node_archive" --strip-components=1)
fi
export PATH="$node_cache/bin:$PATH"
[[ $(node --version) == "v$node_version" ]] || fail 'Unexpected Node version.'
uv python install "$python_version"
export UV_PYTHON="$python_version"
version=$(node -p "require('./ts/package.json').version")
py_version=$(cd python && uv version --short)
[[ $version == "$py_version" ]] || fail "TypeScript $version and Python $py_version must match."
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][a-zA-Z0-9.-]+)?$ ]] || fail 'Invalid release version.'
previous=$(git tag --sort=-creatordate | head -n 1)
run_dir="$root/.release-local/$version-$sha"
[[ ! -e $run_dir ]] || fail "Run directory already exists: $run_dir. Retain it; move it aside explicitly to rerun."
mkdir -p "$run_dir/files" "$run_dir/reports" "$run_dir/logs" "$run_dir/tools"
export RELEASE_RUN_DIR="$run_dir" RELEASE_SHA="$sha" RELEASE_VERSION="$version"
export RELEASE_NODE_VERSION="$node_version" RELEASE_PYTHON_VERSION="$python_version" RELEASE_UV_VERSION="$uv_version"
node <<'JS'
const fs = require('node:fs');
const e = process.env;
fs.writeFileSync(`${e.RELEASE_RUN_DIR}/report.json`, JSON.stringify({
  commit: e.RELEASE_SHA, version: e.RELEASE_VERSION,
  workflow: '.github/workflows/build-release-artifacts.yml',
  rerun: {cwd: '.', argv: ['scripts/release-local.sh', '--no-publish']},
  tools: {node: e.RELEASE_NODE_VERSION, python: e.RELEASE_PYTHON_VERSION, uv: e.RELEASE_UV_VERSION},
  artifacts: [], checks: [], notVerifiedLocally: [], result: 'running'
}, null, 2) + '\n');
JS

record() {
  node - "$run_dir/report.json" "$@" <<'JS'
const fs = require('node:fs');
const [file, name, cwd, command, result, status] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file));
report.checks.push({name, cwd, command, result, exitCode: Number(status)});
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
JS
}

finish() {
  status=$?
  trap - EXIT
  if [[ -n $run_dir ]]; then
    node - "$run_dir/report.json" "$status" <<'JS'
const fs = require('node:fs');
const [file, status] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file));
report.result = status === '0' ? 'passed' : 'failed';
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
JS
    echo "Report: $run_dir/report.json"
  fi
  if [[ -n $worktree ]]; then git worktree remove --force "$worktree"; fi
  exit "$status"
}
trap finish EXIT

check() {
  local name=$1 cwd=$2 status=0 rendered
  shift 2
  printf -v rendered '%q ' "$@"
  echo "== $name: $rendered"
  (cd "$cwd" && "$@") 2>&1 | tee "$run_dir/logs/$name.log" || status=$?
  record "$name" "$cwd" "$rendered" "$([[ $status == 0 ]] && echo passed || echo failed)" "$status"
  return "$status"
}
record source . 'git status --porcelain; git fetch origin main --tags; git rev-parse HEAD origin/main' passed 0
record versions . 'node -p "require(\"./ts/package.json\").version"; (cd python && uv version --short)' passed 0

clashes() {
  local response code status=0
  # Distinguish an absent release (404) from authentication/network failures.
  response="$run_dir/logs/release-lookup.json"
  if gh api "repos/$repo/releases/tags/$version" > "$response" 2> "$run_dir/logs/release-lookup.log"; then
    fail "GitHub release $version already exists. Bump both package versions."
  else
    node - "$response" <<'JS' || fail 'GitHub release lookup failed; check gh authentication and connectivity.'
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(process.argv[2]));
if (String(data.status) !== '404') process.exit(1);
JS
  fi
  record release-clash . "gh api repos/$repo/releases/tags/$version" passed 0
  if git show-ref --verify --quiet "refs/tags/$version"; then fail "Tag $version already exists."; fi
  record tag-clash . "git show-ref --verify --quiet refs/tags/$version (must be absent)" passed 0
  for registry in npm pypi; do
    case $registry in
      npm) url="https://registry.npmjs.org/@arex-research%2fts-sdk/$version" ;;
      pypi) url="https://pypi.org/pypi/arex-python-sdk/$version/json" ;;
    esac
    code=$(curl --silent --show-error --location --output "$run_dir/logs/$registry-lookup.json" --write-out '%{http_code}' "$url") || status=$?
    [[ $status == 0 && $code == 404 ]] || fail "$registry version lookup returned $code; version must be absent (404)."
    record "$registry-clash" . "curl $url (must return 404)" passed 0
  done
}
if $publish; then clashes; else
  record version-clashes . 'Release, tag and registry existence checks are publish-only, as in the workflow.' skipped 0
fi
check docker . docker info --format '{{.Architecture}}'
worktree="$run_dir/worktree"
check worktree . git worktree add --detach "$worktree" "$sha"
for command in 'npm ci' 'npm run check:generated' 'npm run lint' 'npm run typecheck' 'npm test'; do
  check "ts-${command// /-}" "$worktree/ts" bash -c "$command"
done
check ts-pack "$worktree/ts" npm pack --pack-destination "$run_dir/files"
for command in 'uv sync --frozen' 'uv run python scripts/generate_wire.py --check' 'uv run ruff check .' 'uv run ruff format --check .' 'uv run mypy' 'uv run pytest'; do
  name=${command// /-}; name=${name//\//-}
  check "$name" "$worktree/python" bash -c "$command"
done
check python-build "$worktree/python" uv build --out-dir "$run_dir/files"
check checksums "$run_dir/files" bash -c 'shasum -a 256 -- * | tee ../SHA256SUMS'
node - "$run_dir" <<'JS'
const fs = require('node:fs');
const dir = process.argv[2];
const report = JSON.parse(fs.readFileSync(`${dir}/report.json`));
report.artifacts = fs.readFileSync(`${dir}/SHA256SUMS`, 'utf8').trim().split('\n').map(line => {
  const [, sha256, file] = line.match(/^([a-f0-9]{64})  (.+)$/);
  return {file, sha256};
});
fs.writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2) + '\n');
JS
{
  echo '**Give your agents the power to search, read, and research the web, powered by AREX’s public API.**'
  echo
  echo '## Install'
  echo
  echo '### TypeScript'
  echo
  echo 'From npm:'
  echo
  echo '```sh'
  echo "npm install @arex-research/ts-sdk@$version"
  echo '```'
  echo
  echo 'Or download the .tgz asset below:'
  echo
  echo '```sh'
  echo "npm install ./arex-research-ts-sdk-$version.tgz"
  echo '```'
  echo
  echo '### Python'
  echo
  echo 'From PyPI:'
  echo
  echo '```sh'
  echo "pip install arex-python-sdk==$version"
  echo '```'
  echo
  echo 'Or download the .whl asset below:'
  echo
  echo '```sh'
  echo "pip install ./arex_python_sdk-$version-py3-none-any.whl"
  echo '```'
  echo
  echo "## What's changed"
  echo
  git log --no-merges --pretty='- %s' ${previous:+"$previous..HEAD"}
  if [[ -n $previous ]]; then
    echo
    echo "**Full changelog**: https://github.com/$repo/compare/$previous...$version"
  fi
} > "$run_dir/notes.md"
record notes . 'Write the workflow release notes using VERSION and PREVIOUS.' passed 0
check source-archive . git archive --format=tar --output="$run_dir/source.tar" "$sha"

# Every workflow runner is Linux. Native arm64 and Linux amd64 (when Docker can
# emulate it) are both attempted; inability to run a platform is reported.
platforms=()
for platform in linux/arm64 linux/amd64; do
  name=${platform//\//-}
  check "pull-$name" . docker pull --platform "$platform" node:22
  if check "platform-$name" . docker run --rm --platform "$platform" node:22 node --version; then
    platforms+=("$platform")
  else
    node - "$run_dir/report.json" "$platform" <<'JS'
const fs = require('node:fs');
const [file, platform] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file));
report.notVerifiedLocally.push({platform, result: 'not verified locally', reason: 'Docker cannot execute this Linux platform; see platform probe log.'});
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
JS
    echo "$platform: not verified locally"
  fi
done
[[ ${#platforms[@]} -gt 0 ]] || fail 'Docker cannot run either Linux platform.'

for platform in "${platforms[@]}"; do
  suffix=${platform//\//-}
  mkdir -p "$run_dir/tools/$suffix"
  check "pull-uv-$suffix" . docker pull --platform "$platform" "ghcr.io/astral-sh/uv:$uv_version"
  container=$(docker create --platform "$platform" "ghcr.io/astral-sh/uv:$uv_version")
  docker cp "$container:/uv" "$run_dir/tools/$suffix/uv"
  docker rm "$container" >/dev/null
  container=$(docker create --platform "$platform" node:22)
  docker cp "$container:/usr/local/bin/node" "$run_dir/tools/$suffix/node"
  docker rm "$container" >/dev/null
  for runtime in 20 22 24 bun 3.10 3.12 3.13; do
    case $runtime in
      20|22|24)
        image="node:$runtime"
        body='cd /work/ts; npm ci; cd /release/files; sha256sum --check ../SHA256SUMS; cd /work/ts; node scripts/check-package.mjs /release/files/*.tgz --runtime node --expected-version "$VERSION" --report "/reports/ts-node-$RUNTIME-$SUFFIX.json"'
        ;;
      bun)
        image=oven/bun:latest
        body='cd /release/files; sha256sum --check ../SHA256SUMS; cd /work/ts; bun --version; node scripts/check-package.mjs /release/files/*.tgz --runtime bun --expected-version "$VERSION" --report "/reports/ts-bun-$SUFFIX.json"'
        ;;
      *)
        image="python:$runtime"
        body='cd /work/python; uv sync --frozen; cd /release/files; sha256sum --check ../SHA256SUMS; cd /work/python; uv run python scripts/check_package.py /release/files/*.whl /release/files/*.tar.gz --expected-version "$VERSION" --report "/reports/python-$RUNTIME-$SUFFIX.json"'
        ;;
    esac
    check "pull-$runtime-$suffix" . docker pull --platform "$platform" "$image"
    check "smoke-$runtime-$suffix" . docker run --rm --platform "$platform" \
      --mount "type=bind,src=$run_dir/files,dst=/release/files,readonly" \
      --mount "type=bind,src=$run_dir/SHA256SUMS,dst=/release/SHA256SUMS,readonly" \
      --mount "type=bind,src=$run_dir/source.tar,dst=/source.tar,readonly" \
      --mount "type=bind,src=$run_dir/tools/$suffix,dst=/tools,readonly" \
      --mount "type=bind,src=$run_dir/reports,dst=/reports" \
      --env "VERSION=$version" --env "RUNTIME=$runtime" --env "SUFFIX=$suffix" \
      --env "UV_PYTHON=$runtime" --env UV_PYTHON_DOWNLOADS=never \
      --entrypoint /bin/bash "$image" -ec \
      "export PATH=\$PATH:/tools; mkdir /work; tar -xf /source.tar -C /work; $body"
  done
done

if ! $publish; then
  echo 'All available container checks passed. No publication requested.'
  exit 0
fi
[[ -t 0 && -t 1 ]] || fail 'Publishing requires an interactive terminal.'
printf 'Type the version (%s) to publish these exact checked files: ' "$version"
read -r confirmation
[[ $confirmation == "$version" ]] || fail 'Confirmation did not match; nothing published.'
check publish-checksums "$run_dir/files" shasum -a 256 --check ../SHA256SUMS
if ! npm whoami --registry https://registry.npmjs.org/; then
  fail 'Run npm login, then restart the reviewed manual release procedure.'
fi
# Leave npm attached to the terminal so it can request an OTP itself.
npm_status=0
npm publish "$run_dir"/files/*.tgz --access public --ignore-scripts --registry https://registry.npmjs.org/ || npm_status=$?
record publish-npm . 'npm publish files/*.tgz --access public --ignore-scripts --registry https://registry.npmjs.org/' "$([[ $npm_status == 0 ]] && echo passed || echo failed)" "$npm_status"
[[ $npm_status == 0 ]] || fail 'npm publication failed; retain this run directory for recovery.'
check pypi-checksums "$run_dir/files" shasum -a 256 --check ../SHA256SUMS
printf 'PyPI API token (hidden): '
read -r -s pypi_token
printf '\n'
[[ -n $pypi_token ]] || fail 'An empty PyPI token is not accepted.'
# Never send token-bearing commands through check(), logs, or the JSON report.
pypi_status=0
UV_PUBLISH_TOKEN="$pypi_token" uv publish "$run_dir"/files/*.whl "$run_dir"/files/*.tar.gz || pypi_status=$?
unset pypi_token
record publish-pypi . 'UV_PUBLISH_TOKEN=<interactive secret> uv publish files/*.whl files/*.tar.gz' "$([[ $pypi_status == 0 ]] && echo passed || echo failed)" "$pypi_status"
[[ $pypi_status == 0 ]] || fail 'PyPI publication failed; retain this run directory for recovery.'
check github-checksums "$run_dir/files" shasum -a 256 --check ../SHA256SUMS
check publish-github . gh release create "$version" "$run_dir"/files/* \
  --repo "$repo" --target "$sha" --title "$version" --notes-file "$run_dir/notes.md"
