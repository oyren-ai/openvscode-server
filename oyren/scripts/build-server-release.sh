#!/usr/bin/env bash
# Build the Oyren openvscode-server linux-x64 release tarball ON an oyren.ai droplet — the native
# replacement for .github/workflows/build-oyren-release.yml (GitHub Actions is disabled repo-wide
# by owner decision, 2026-08-12; droplets ARE linux-x64, so this is the same build, same steps,
# no cross-compilation). Mirrors the workflow stanza for stanza; when editing one, edit both.
#
# Usage (in a droplet terminal, ~60-90 min, needs ~16GB of RAM+swap):
#   GH_TOKEN=<token with repo scope> oyren/scripts/build-server-release.sh openvscode-server-v1.109.5-oyren.6
# The tag must already exist. Publishes <tag>-linux-x64.tar.gz onto the tag's GitHub release.
# Ship AFTER verifying: bump oyren/SERVER_VERSION to the version and run pack-editor-extras.sh.
set -euo pipefail

TAG="${1:?usage: build-server-release.sh <openvscode-server-v*-oyren.* tag>}"
case "$TAG" in openvscode-server-v*-oyren.*) ;; *) echo "tag must match openvscode-server-v*-oyren.*" >&2; exit 1 ;; esac
VERSION="${TAG#openvscode-server-v}"
REPO="oyren-ai/openvscode-server"
[ "$(uname -s)/$(uname -m)" = "Linux/x86_64" ] || { echo "must run on linux x64 (an oyren droplet); this is $(uname -sm)" >&2; exit 1; }

# The repo must sit one level below the build root: gulpfile.reh.ts derives BUILD_ROOT from the
# repo's PARENT, and the reh output lands there.
# set -e safe both as root (SUDO empty) and as a sudoer.
if [ "$(id -u)" = 0 ]; then SUDO=""; else SUDO="sudo"; fi

BUILD_ROOT="${BUILD_ROOT:-$HOME/oyren-server-build}"
mkdir -p "$BUILD_ROOT"
cd "$BUILD_ROOT"
[ -d openvscode-server/.git ] || git clone "https://github.com/$REPO.git" openvscode-server
cd openvscode-server
git fetch --tags --force origin
git checkout --force "$TAG"

# CI's load-bearing RAM mitigation (16GB runner + 8GB swap). Same headroom here or the linker dies.
if ! free -g | awk '/^Mem|^Swap/ {t+=$2} END {exit (t>=20?0:1)}'; then
  echo "adding 8G swap (needs sudo)…"
  sudo fallocate -l 8G /swapfile.oyren-build && sudo chmod 600 /swapfile.oyren-build \
    && sudo mkswap /swapfile.oyren-build && sudo swapon /swapfile.oyren-build
fi

sudo apt-get update -qq
sudo apt-get install -y -qq build-essential g++ python3 python-is-python3 pkg-config jq \
  libxkbfile-dev libkrb5-dev libgtk-3-0 libgbm1 # no xvfb: tests are skipped, same as the workflow
# python-is-python3: setup-env.sh calls bare `python`; GitHub runner images alias it, stock Ubuntu doesn't.

# Node must match .nvmrc (native modules compile against its headers). Installed as the official
# tarball into /opt/node — NOT nvm: nvm.sh misbehaves silently under `set -u` (observed: sourced
# fine, installed nothing, and the script marched on into `npm: command not found`).
WANT="$(cat .nvmrc)"
[ -x "/opt/node-v$WANT/bin/node" ] && export PATH="/opt/node-v$WANT/bin:$PATH"
if [ "$(node -v 2>/dev/null)" != "v$WANT" ]; then
  echo "installing node v$WANT to /opt/node-v$WANT…"
  curl -fsSL "https://nodejs.org/dist/v${WANT}/node-v${WANT}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  $SUDO mkdir -p "/opt/node-v$WANT"
  $SUDO tar -xJf /tmp/node.tar.xz -C "/opt/node-v$WANT" --strip-components=1
  rm -f /tmp/node.tar.xz
  export PATH="/opt/node-v$WANT/bin:$PATH"
  [ "$(node -v)" = "v$WANT" ] || { echo "node install failed: $(node -v 2>&1)" >&2; exit 1; }
fi

export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_arch=x64
export OS_NAME=linux VSCODE_ARCH=x64 # the workflow's job-level env block, verbatim
retry_ci() { for i in 1 2 3 4 5; do npm ci && return; [ "$i" = 5 ] && { echo "npm ci failed too many times" >&2; exit 1; }; echo "npm ci failed ($i), retrying…"; done; }
( cd build && retry_ci )
# setup-env.sh is written for CI's plain bash — it reads vars that may be unset, so -u pauses here.
set +u; source ./build/azure-pipelines/linux/setup-env.sh; set -u
node build/npm/preinstall.ts # patches v8 headers BEFORE root deps, per the workflow
retry_ci

# product.json: quality + browser-visible names are INLINED into workbench.js at build time —
# runtime product.overrides.json provably cannot reach them, so they're set here (workflow verbatim).
jq 'setpath(["quality"]; "stable") | setpath(["nameShort"]; "Oyren Editor") | setpath(["nameLong"]; "Oyren Editor")' \
  product.json > product.json.tmp && mv product.json.tmp product.json

base_commit=$(git log --pretty=%H --max-count=1 --grep "code web server initial commit")
[ -n "$base_commit" ] || { echo "could not find the distro base commit" >&2; exit 1; }
export BUILD_SOURCEVERSION="$(git rev-parse "${base_commit}~")"

export DISABLE_V8_COMPILE_CACHE=1
npm run gulp core-ci
npm run gulp extensions-ci
npm run gulp minify-vscode-reh-web
npm run gulp vscode-reh-web-linux-x64-min-ci

cd "$BUILD_ROOT"
name="openvscode-server-v${VERSION}-linux-x64"
rm -rf "$name"
mv vscode-reh-web-linux-x64 "$name"
tar -czf "$name.tar.gz" "$name"
ls -lh "$name.tar.gz"

gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 \
  || gh release create "$TAG" --repo "$REPO" --title "$TAG" --notes "Oyren build of OpenVSCode Server $VERSION (built on an oyren.ai droplet)"
gh release upload "$TAG" --repo "$REPO" --clobber "$name.tar.gz"

echo "✅ $name.tar.gz published on release $TAG"
echo "To ship it to sessions: set oyren/SERVER_VERSION to ${VERSION} and run oyren/scripts/pack-editor-extras.sh"
