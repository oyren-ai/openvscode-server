## TL;DR
Adds support for pasting images directly into the VS Code terminal. The image is uploaded to `/tmp/oyren-terminal-pastes/` and its absolute path is inserted into the terminal prompt. Implemented by listening for the `paste` event on `xtermHost` in the browser client, sending the base64-encoded image to the `oyren-agent-extension` (running in the backend Extension Host) via `executeCommand`, which then writes the file and sends the path back to the active terminal. Enforces a 10MB limit.

- Fixes issue where pasting images into terminal failed or prompted to upload to workspace.
- Addresses codex/Claude Code use cases for pasting error screenshots directly to the terminal.
