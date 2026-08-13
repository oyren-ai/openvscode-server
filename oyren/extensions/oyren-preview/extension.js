const vscode = require("vscode");
const http = require("http");

/**
 * "Mini browser inside VS Code" for a sandbox's own dev server: no public URL/DNS involved, since
 * this extension and the server it previews run on the same machine. Opens the built-in Simple
 * Browser (already bundled with openvscode-server) pointed at http://localhost:<port>.
 *
 * Port choice: sandbox-runtime's route list (the same one `oyren route add/list` manages) is read
 * as a CONVENIENCE only — routes exist for public exposure via the edge, which this feature doesn't
 * need, so an app not yet routed is still previewable via manual port entry.
 */
const LAST_PORT_KEY = "oyren.preview.lastPort";

function fetchRoutes() {
  return new Promise((resolve) => {
    const port = Number(process.env.PORT || 8080);
    const token = process.env.CONTROL_TOKEN || "";
    if (!token) return resolve([]);
    const body = "{}";
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/_oyren/control/route/list",
        timeout: 2000,
        headers: {
          "content-type": "application/json",
          "x-oyren-control-token": token,
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data || "{}");
            resolve(Array.isArray(parsed.routes) ? parsed.routes : []);
          } catch {
            resolve([]);
          }
        });
      },
    );
    req.on("error", () => resolve([]));
    req.on("timeout", () => {
      req.destroy();
      resolve([]);
    });
    req.end(body);
  });
}

async function promptForPort(lastPort) {
  const input = await vscode.window.showInputBox({
    prompt: "Port to preview",
    placeHolder: "3000",
    value: lastPort ? String(lastPort) : "",
    validateInput: (v) => (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536 ? undefined : "Enter a valid port number"),
  });
  return input ? Number(input) : undefined;
}

async function pickPort(context, out) {
  let routes = [];
  try {
    routes = await fetchRoutes();
  } catch (err) {
    out.appendLine(`route discovery failed: ${err && err.message}`);
  }

  const lastPort = context.globalState.get(LAST_PORT_KEY);
  const routeItems = routes
    .filter((r) => Number(r.port) > 0)
    .map((r) => ({
      label: `$(globe) ${r.label || r.prefix || "route"}`,
      description: `localhost:${r.port}`,
      port: Number(r.port),
    }));

  // Zero known routes is the common case (nothing registered for public exposure yet) — skip
  // straight to manual entry instead of showing a QuickPick with only its own escape hatch.
  if (routeItems.length === 0) {
    const port = await promptForPort(lastPort);
    if (port) await context.globalState.update(LAST_PORT_KEY, port);
    return port;
  }

  routeItems.push({
    label: "$(edit) Enter port manually…",
    description: lastPort ? `last used: ${lastPort}` : undefined,
    manual: true,
  });

  const choice = await vscode.window.showQuickPick(routeItems, { placeHolder: "Preview which local server?" });
  if (!choice) return undefined;
  if (!choice.manual) return choice.port;

  const port = await promptForPort(lastPort);
  if (port) await context.globalState.update(LAST_PORT_KEY, port);
  return port;
}

async function openPreview(context, out) {
  try {
    const port = await pickPort(context, out);
    if (!port) return;
    const url = `http://localhost:${port}`;
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
