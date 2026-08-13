const vscode = require("vscode");

/**
 * Port choice: sandbox-runtime's route list (the same one `oyren route add/list` manages) is read
 * as a CONVENIENCE only — routes exist for public exposure via the edge, which this feature doesn't
 * need, so an app not yet routed is still previewable via manual port entry.
 */
const LAST_PORT_KEY = "oyren.preview.lastPort";

async function promptForPort(lastPort) {
  const input = await vscode.window.showInputBox({
    prompt: "Port to preview",
    placeHolder: "3000",
    value: lastPort ? String(lastPort) : "",
    validateInput: (v) => (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536 ? undefined : "Enter a valid port number"),
  });
  return input ? Number(input) : undefined;
}

async function pickPort(context, routes) {
  const lastPort = context.globalState.get(LAST_PORT_KEY);
  const routeItems = (routes || [])
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

module.exports = { pickPort };
