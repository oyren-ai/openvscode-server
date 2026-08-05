# @oyren.ai/openvscode-server

[openvscode-server](https://github.com/gitpod-io/openvscode-server) built with **third-party chat
participants enabled** — run your own agent in VS Code's built-in Chat view, no Copilot required.

Stock Code-OSS builds carry a hardcoded Copilot setup agent that intercepts every Chat request
before any extension participant is consulted. This build removes it: four small patches, see the
[fork](https://github.com/oyren-ai/openvscode-server/tree/oyren/1.109) — everything else is
upstream openvscode-server.

## Usage

```bash
npm i -g @oyren.ai/openvscode-server   # downloads the linux-x64 release tarball on install
openvscode-server --host 0.0.0.0 --port 3000
```

linux-x64 only for now. Air-gapped installs: set `OPENVSCODE_MIRROR` to a URL serving the release
tarballs. The same tarball powers the editor in [oyren.ai](https://oyren.ai) sandboxes.
