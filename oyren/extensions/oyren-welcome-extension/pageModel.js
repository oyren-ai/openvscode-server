// Everything the welcome page shows, gathered from this machine. Kept apart from extension.js so the
// one place that reads the environment is short enough to audit: REPO_FULL_NAME(S) and AGENT_KIND go
// through facts.js, PATH is only searched for agent binaries (never shown), and nothing else is read.
const crypto = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { codespaceFacts, repoNames } = require("./facts")
const { installedAgents } = require("./agents")
const { presentEditorApps } = require("./editorApps")
const { CODESPACE_APPS } = require("./codespaceApps")

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** An installed extension's own marketplace icon, or null (the card then draws its tile). */
function extensionIcon(vscode, id) {
  const extension = id && vscode.extensions.getExtension(id)
  const icon = extension && extension.packageJSON && extension.packageJSON.icon
  return icon ? vscode.Uri.joinPath(extension.extensionUri, icon) : null
}

const hasExtension = (vscode) => (id) => Boolean(vscode.extensions.getExtension(id))

/** The webview may read our media folder and the folders holding the shown extensions' icons, only. */
function localResourceRoots(vscode, context) {
  const roots = [vscode.Uri.joinPath(context.extensionUri, "media")]
  for (const app of presentEditorApps(hasExtension(vscode))) {
    const icon = extensionIcon(vscode, app.extension)
    if (icon) roots.push(vscode.Uri.joinPath(icon, ".."))
  }
  return roots
}

function pageModel({ vscode, context, webview, showOnStartup, env = process.env }) {
  const asset = (name) => String(webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", name)))
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
  const repos = repoNames(env)
  return {
    nonce: crypto.randomBytes(18).toString("base64"),
    cspSource: webview.cspSource,
    styleUri: asset("welcome.css"),
    scriptUri: asset("welcome.js"),
    title: "Welcome to your Codespace",
    subtitle: repos.length ? repos.join(", ") : folder ? path.basename(folder) : "",
    facts: codespaceFacts({
      env, folder, cpus: os.cpus().length, totalmem: os.totalmem(), installed: installedAgents(env.PATH, isExecutable),
    }),
    editorApps: presentEditorApps(hasExtension(vscode)).map((app) => {
      const icon = extensionIcon(vscode, app.extension)
      return { ...app, iconUri: icon ? String(webview.asWebviewUri(icon)) : null }
    }),
    codespaceApps: CODESPACE_APPS,
    showOnStartup,
  }
}

module.exports = { pageModel, localResourceRoots }
