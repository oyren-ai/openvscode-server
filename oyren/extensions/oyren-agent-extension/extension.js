const vscode = require("vscode")
const { createClient } = require("./agentClient")
const { makeHandler } = require("./turnHandler")
const { createModelProvider } = require("./modelProvider")
const { registerSessionProviders } = require("./sessionProviders")

/**
 * The production successor to oyren-chat-probe: VS Code's built-in Chat view, backed by the sandbox
 * agent for ALL seven providers (docs/oyren-chat-participant.md). The extension host runs inside the
 * droplet, so it dials the runtime directly on 127.0.0.1 — no CORS, no trip through the edge.
 *
 * Registration is wrapped, never thrown: a thrown activation is indistinguishable from the Chat view
 * simply being absent, and the two failures have completely different fixes.
 */

function activate(context) {
  const client = createClient()

  if (vscode.chat && typeof vscode.chat.createChatParticipant === "function") {
    try {
      context.subscriptions.push(vscode.chat.createChatParticipant("oyren.agent", makeHandler(client)))
    } catch (err) {
      console.error(`oyren-agent: participant registration failed: ${err && err.message}`)
    }
  }

  // The model picker path. Registered even with no session token: the provider's fallback model is
  // what keeps the picker populated on a self-hosted editor instead of an empty, nagging dropdown.
  if (vscode.lm && typeof vscode.lm.registerLanguageModelChatProvider === "function") {
    try {
      context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider("oyren", createModelProvider(client)))
      // Force EAGER model resolution. The workbench resolves a vendor's models lazily unless the
      // user has previously stored a pick of that vendor — and the extension host resolves a model
      // BEFORE invoking the participant handler, so an unresolved vendor can throw "Language model
      // unavailable" without our code ever running. One select at activation runs the resolution
      // now, and fills the picker with real model names instead of the synthetic "Auto" entry.
      vscode.lm.selectChatModels({ vendor: "oyren" }).then(undefined, () => {})
    } catch (err) {
      console.error(`oyren-agent: model provider registration failed: ${err && err.message}`)
    }
  }

  // Image paste for the terminal
  try {
    context.subscriptions.push(vscode.commands.registerCommand('oyren.terminal.pasteImage', async (args) => {
      if (!args || !args.base64 || !args.mime) return
      
      // We are in the Extension Host, running Node.js in the sandbox container.
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const crypto = require('crypto');
      const userInfo = os.userInfo();
      const dir = process.env.OYREN_TERMINAL_PASTE_DIR || path.join(os.tmpdir(), "oyren-terminal-pastes-" + userInfo.username);
      
      const MAX_BYTES = 10 * 1024 * 1024;
      if (args.base64.length > (MAX_BYTES * 4 / 3) + 1000) return;
      const buf = Buffer.from(args.base64, 'base64');
      if (buf.length > MAX_BYTES) return;

      const EXT_BY_MIME = {
        "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
        "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp"
      }
      const requestedExt = EXT_BY_MIME[String(args.mime).toLowerCase()];
      if (!requestedExt) return;

      // Verify Magic Bytes
      let magicMatch = false;
      let ext = "";
      if (buf.length >= 4) {
          const hex = buf.toString('hex', 0, 4).toUpperCase();
          const hex12 = buf.length >= 12 ? buf.toString('hex', 0, 12).toUpperCase() : '';
          
          if (hex.startsWith('89504E47')) {
              magicMatch = true; ext = "png";
          } else if (hex.startsWith('FFD8FF')) {
              magicMatch = true; ext = "jpg";
          } else if (hex.startsWith('47494638')) { // GIF8
              magicMatch = true; ext = "gif";
          } else if (hex.startsWith('424D')) { // BM
              magicMatch = true; ext = "bmp";
          } else if (hex.startsWith('52494646') && hex12.endsWith('57454250')) { // RIFF...WEBP
              magicMatch = true; ext = "webp";
          }
      }
      if (!magicMatch) {
          console.error('oyren-agent: pasteImage failed: invalid image magic bytes');
          return;
      }

      // Safe directory creation
      try {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch (e) {
          // ignore
      }
      // Ensure dir is a directory owned by user and mode 700
      try {
          const stats = fs.lstatSync(dir);
          if (!stats.isDirectory() || stats.uid !== userInfo.uid) {
              console.error('oyren-agent: pasteImage failed: invalid paste directory');
              return;
          }
      } catch (e) {
          return;
      }

      const randomBytes = crypto.randomBytes(16).toString('hex');
      const name = `paste-${randomBytes}.${ext}`;
      const dest = path.join(dir, name);
      
      try {
          fs.writeFileSync(dest, buf, { mode: 0o600, flag: 'wx' });
          return dest;
      } catch (err) {
          console.error(`oyren-agent: pasteImage write failed: ${err.message}`);
          return;
      }
    }))
  } catch (err) {
    console.error(`oyren-agent: pasteImage registration failed: ${err && err.message}`)
  }

  // The agent-type dropdown: one chat session per CLI agent, on our patched build.
  registerSessionProviders(context)
}

function deactivate() {}

module.exports = { activate, deactivate }
