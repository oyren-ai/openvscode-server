// postinstall: fetch the prebuilt server for this platform from the fork's GitHub Release.
//
// A thin wrapper rather than a fat package on purpose: the unpacked server is ~400MB, npm installs
// it once per project otherwise, and GitHub Releases stays the single source of truth for binaries —
// the same tarball this downloads is the one the Oyren bake installs. Mirror-friendly via
// OPENVSCODE_MIRROR for air-gapped installs.
"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require("./package.json");
const version = pkg.version; // e.g. "1.109.5-oyren.1" — release tag is "openvscode-server-v" + this
const dest = path.join(__dirname, "dist");

// Only linux builds exist today. A non-linux install still succeeds (so `npm i` on a laptop doesn't
// explode) but explains itself instead of downloading something that cannot run.
if (process.platform !== "linux" || process.arch !== "x64") {
  console.warn(`@oyren.ai/openvscode-server: no prebuilt binary for ${process.platform}-${process.arch} (linux-x64 only for now); skipping download.`);
  process.exit(0);
}

if (fs.existsSync(path.join(dest, "bin", "openvscode-server"))) {
  process.exit(0); // already fetched (reinstall / offline rebuild)
}

const base = process.env.OPENVSCODE_MIRROR ||
  `https://github.com/oyren-ai/openvscode-server/releases/download/openvscode-server-v${version}`;
const name = `openvscode-server-v${version}-linux-x64`;
const url = `${base}/${name}.tar.gz`;
const tarball = path.join(__dirname, `${name}.tar.gz`);

console.log(`Downloading ${url}`);
try {
  // curl+tar rather than a JS download stack: zero runtime deps in this package, and both tools are
  // a given on any linux host that can run the server itself.
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", tarball, url], { stdio: "inherit" });
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", dest, "--strip-components=1"], { stdio: "inherit" });
  fs.rmSync(tarball, { force: true });
  console.log(`openvscode-server v${version} installed.`);
} catch (err) {
  fs.rmSync(tarball, { force: true });
  console.error(`Download failed: ${err.message}`);
  console.error("Set OPENVSCODE_MIRROR to a URL serving the release tarballs, or download manually from the GitHub release.");
  process.exit(1);
}
