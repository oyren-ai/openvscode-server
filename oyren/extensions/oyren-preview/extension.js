const vscode = require("vscode");
const { fetchSession } = require("./control");
const { pickPort } = require("./ports");
const { previewUrl } = require("./previewUrl");

/**
 * "Mini browser inside VS Code" for a sandbox's own dev server. Opens the built-in Simple Browser
 * (already bundled with openvscode-server) at a URL the user's browser can actually load — see
 * previewUrl.js for why literal http://localhost:<port> breaks in production.
 */
async function openPreview(context, out) {
  try {
    const session = await fetchSession();
    const port = await pickPort(context, session.routes);
    if (!port) return;
    const url = await previewUrl(port, session.origin, (msg) => out.appendLine(msg));
    out.appendLine(`opening ${url}`);
    await vscode.commands.executeCommand("simpleBrowser.show", url);
  } catch (err) {
    out.appendLine(`open preview failed: ${err && err.message}`);
    vscode.window.showErrorMessage(`Oyren Preview: ${(err && err.message) || err}`);
  }
}

function activate(context) {
  const out = vscode.window.createOutputChannel("Oyren Preview");
  context.subscriptions.push(out);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(browser) Oyren Preview";
  status.tooltip = "Preview a local dev server inside VS Code";
  status.command = "oyren.preview.open";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(vscode.commands.registerCommand("oyren.preview.open", () => openPreview(context, out)));
}

function deactivate() {}

module.exports = { activate, deactivate };
