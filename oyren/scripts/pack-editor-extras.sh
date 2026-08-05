#!/usr/bin/env bash
# Publish the editor's fast-changing layer — the Oyren extensions, settings, product overrides and
# the desired server version — as the rolling "editor-extras" release on this repo. Every session
# installs it at editor start (oyren-editor-update --boot) and a live session refreshes with
# `oyren-editor-update`, so shipping an extension or settings tweak is THIS script (~seconds), not
# a snapshot bake (~15 minutes). The bake downloads the same tarball for its offline fallback, so
# there is exactly ONE source of truth: this release.
#
# server-version (from ../SERVER_VERSION) tells sessions which openvscode build to run; when it
# differs from the installed one, oyren-editor-update swaps the whole server at boot — that is how
# a new fork build ships without a bake.
#
# Usage: ./pack-editor-extras.sh          (needs gh auth with repo access)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)" # the oyren/ dir
REPO="oyren-ai/openvscode-server"
TAG="editor-extras"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

mkdir -p "$OUT/pack/extensions" "$OUT/pack/settings" "$OUT/pack/scripts"
cp -R "$ROOT/extensions/oyren-agent-extension" "$OUT/pack/extensions/"
cp -R "$ROOT/extensions/oyren-welcome-extension" "$OUT/pack/extensions/"
cp "$ROOT/settings/machine-settings.json" "$OUT/pack/settings/"
cp "$ROOT/settings/user-settings.json" "$OUT/pack/settings/"
cp "$ROOT/settings/product.overrides.json" "$OUT/pack/settings/"
cp "$HERE/merge-product.js" "$OUT/pack/scripts/"
tr -d '[:space:]' < "$ROOT/SERVER_VERSION" > "$OUT/pack/server-version"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$OUT/pack/BUILT_AT"

# Sanity before anything leaves this machine: broken JSON here bricks every new session's editor
# layer until the next publish.
[ -s "$OUT/pack/server-version" ] || { echo "SERVER_VERSION is empty" >&2; exit 1; }
node -e 'for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f))' \
  "$OUT"/pack/extensions/*/package.json "$OUT"/pack/settings/*.json
for js in "$OUT"/pack/extensions/*/*.js "$OUT"/pack/scripts/*.js; do node --check "$js"; done

tar -czf "$OUT/oyren-editor-extras.tar.gz" -C "$OUT/pack" extensions settings scripts BUILT_AT server-version
ls -lh "$OUT/oyren-editor-extras.tar.gz"

# Rolling release: same tag forever, asset clobbered. Prerelease so it never shadows real builds.
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 \
  || gh release create "$TAG" --repo "$REPO" --prerelease --title "editor extras (rolling)" \
       --notes "Rolling channel for the Oyren editor's extensions + settings + desired server version. Sessions fetch this at editor start; the snapshot bake downloads the same tarball for its offline fallback. Not a server build."
gh release upload "$TAG" --repo "$REPO" --clobber "$OUT/oyren-editor-extras.tar.gz"
echo "✅ published — new sessions pick it up at boot; live ones via oyren-editor-update"
