#!/usr/bin/env sh
# Sync the published API contract into openapi/arex-v1.json.
# Usage: scripts/sync-openapi.sh [local-file-or-url]
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
target="$here/openapi/arex-v1.json"
source="${1:-https://www.arex-research.com/platform/docs/openapi.json}"
# Keep the checked-in contract intact if fetching or copying fails.
temporary="$(mktemp "${target}.XXXXXX")"
trap 'rm -f "$temporary"' 0
trap 'exit 1' HUP INT TERM
case "$source" in
	http://*|https://*) curl -fsSL "$source" > "$temporary" ;;
	*) cp "$source" "$temporary" ;;
esac
mv "$temporary" "$target"
echo "synced $target"
