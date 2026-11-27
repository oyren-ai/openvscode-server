#!/usr/bin/env bash
# Publish the editor's fast-changing layer — the Oyren extensions, settings, product overrides and
# the desired server version — as the rolling "editor-extras" release on this repo. Every session
# installs it at editor start (oyren-editor-update --boot) and a live session refreshes with
# `oyren-editor-update`, so shipping an extension or settings tweak is THIS script (~seconds), not
# a snapshot bake (~15 minutes). The bake downloads the same tarball for its offline fallback, so
# there is exactly ONE source of truth: this release. It is one channel for dev and production
# alike: publishing reaches every Codespace at its next editor start.
#
# server-version (from ../SERVER_VERSION) tells sessions which openvscode build to run; when it
# differs from the installed one, oyren-editor-update swaps the whole server at boot — that is how
# a new fork build ships without a bake.
#
# Usage (uploading needs gh auth with repo access):
#   ./pack-editor-extras.sh                  pack, test and publish in one go
#   ./pack-editor-extras.sh --pack-only DIR  pack and test into DIR/oyren-editor-extras.tar.gz and print
#                                            its sha256; nothing is uploaded
#   ./pack-editor-extras.sh --upload FILE    publish a tarball packed earlier: exactly those bytes
# The two-step form lets the composer's EDITOR_EXTRAS_SHA256 pin (deploy/versions.env) name the digest
# of the very file that gets published: pack, put the digest in the composer PR, upload that file.
set -euo pipefail

MODE=publish
ARG=""
case "${1:-}" in
  "") ;;
  --pack-only) MODE=pack ARG="${2:?--pack-only needs an output directory}" ;;
  --upload) MODE=upload ARG="${2:?--upload needs a tarball}" ;;
  *) echo "usage: $0 [--pack-only DIR | --upload FILE]" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)" # the oyren/ dir
REPO="oyren-ai/openvscode-server"
TAG="editor-extras"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

digest() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }

# Rolling release: same tag forever, asset clobbered. Prerelease so it never shadows real builds.
publish() {
  local file="$1"
  [ "$(basename "$file")" = "oyren-editor-extras.tar.gz" ] || { echo "the asset must be named oyren-editor-extras.tar.gz" >&2; exit 1; }
  tar -tzf "$file" > "$OUT/listing"
  grep -qx 'server-version' "$OUT/listing" || { echo "$file is not an editor-extras tarball" >&2; exit 1; }
  digest "$file"
  gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 \
    || gh release create "$TAG" --repo "$REPO" --prerelease --title "editor extras (rolling)" \
         --notes "Rolling channel for the Oyren editor's extensions + settings + desired server version. Sessions fetch this at editor start; the snapshot bake downloads the same tarball for its offline fallback. Not a server build."
  gh release upload "$TAG" --repo "$REPO" --clobber "$file"
  echo "✅ published — new sessions pick it up at boot; live ones via oyren-editor-update"
}

if [ "$MODE" = upload ]; then publish "$ARG"; exit 0; fi

mkdir -p "$OUT/pack/extensions" "$OUT/pack/settings" "$OUT/pack/scripts"
cp -R "$ROOT/extensions/oyren-agent-extension" "$OUT/pack/extensions/"
cp -R "$ROOT/extensions/oyren-welcome-extension" "$OUT/pack/extensions/"
cp -R "$ROOT/extensions/oyren-preview" "$OUT/pack/extensions/"
cp "$ROOT/settings/machine-settings.json" "$OUT/pack/settings/"
cp "$ROOT/settings/user-settings.json" "$OUT/pack/settings/"
cp "$ROOT/settings/product.overrides.json" "$OUT/pack/settings/"
cp "$HERE/merge-product.js" "$OUT/pack/scripts/"
tr -d '[:space:]' < "$ROOT/SERVER_VERSION" > "$OUT/pack/server-version"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$OUT/pack/BUILT_AT"

# Unit gate before anything leaves this machine: the agent extension's protocol/provider suite and
# the welcome extension's page/start suite (plain `node --test`, no dependencies — vscode and HTTP
# are faked/local). Runs on the checkout, deliberately NOT in paid CI; a red suite must never publish.
# The welcome suite also diffs its Codespace app list against the hosted registry when
# OYREN_CODESPACE_REPO names an oyren-ai-codespace checkout; set it when you have one.
( cd "$ROOT/extensions/oyren-agent-extension" && node --test )
( cd "$ROOT/extensions/oyren-welcome-extension" && node --test )
# The JS syntax check below only reaches each extension's top level; the welcome page's script
# lives in media/.
for js in "$ROOT"/extensions/*/media/*.js; do if [ -e "$js" ]; then node --check "$js"; fi; done

# Sanity before anything leaves this machine: broken JSON here bricks every new session's editor
# layer until the next publish.
[ -s "$OUT/pack/server-version" ] || { echo "SERVER_VERSION is empty" >&2; exit 1; }
node -e 'for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f))' \
  "$OUT"/pack/extensions/*/package.json "$OUT"/pack/settings/*.json
for js in "$OUT"/pack/extensions/*/*.js "$OUT"/pack/scripts/*.js; do node --check "$js"; done

# COPYFILE_DISABLE keeps macOS tar from adding ._ AppleDouble files (the 2026-09-23 asset has them).
COPYFILE_DISABLE=1 tar -czf "$OUT/oyren-editor-extras.tar.gz" -C "$OUT/pack" extensions settings scripts BUILT_AT server-version
ls -lh "$OUT/oyren-editor-extras.tar.gz"

if [ "$MODE" = pack ]; then
  mkdir -p "$ARG"
  cp "$OUT/oyren-editor-extras.tar.gz" "$ARG/"
  digest "$ARG/oyren-editor-extras.tar.gz"
  exit 0
fi
publish "$OUT/oyren-editor-extras.tar.gz"
