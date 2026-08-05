#!/usr/bin/env node
// Pass straight through to the downloaded server binary. Kept dumb on purpose — flags, defaults and
// docs all live with the server itself, and this must never grow behavior the tarball doesn't have.
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const bin = path.join(__dirname, "..", "dist", "bin", "openvscode-server");
if (!fs.existsSync(bin)) {
  console.error("openvscode-server binary missing — postinstall did not run or this platform has no prebuilt binary (linux-x64 only for now).");
  process.exit(1);
}
const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(r.status ?? 1);
