// The vscode glue for "reattach to the same session all the time" (store: lastSessionStore.js).
// Same-browser reopens are covered natively (chat.restoreLastPanelSession + the fork's
// loadSessionForResource restore fix); this covers a NEW browser or device, whose IndexedDB-backed
// panel state is empty, by reopening the last durable session recorded server-side — and the Claude
// Code panel via its own public command, which reads ~/.claude on the droplet.
const vscode = require("vscode")
const os = require("os")
const { readLastSession, claudeHasSessions } = require("./lastSessionStore")

const OPEN_IN_PANEL_COMMAND = "oyren.chat.openSessionInPanel" // fork core Action2
const CLAUDE_OPEN_LAST = "claude-vscode.editor.openLast"

async function reopenOwnSession(storageDir) {
  const resourceStr = readLastSession(storageDir)
  if (!resourceStr) return
  const resource = vscode.Uri.parse(resourceStr)
  // The session's content provider may not have activated yet at onStartupFinished — retry briefly
  // instead of racing it (core's own opener ordering is activate → canResolve → load).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await vscode.commands.executeCommand(OPEN_IN_PANEL_COMMAND, { resource })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

async function reopenClaudePanel() {
  if (!claudeHasSessions(os.homedir())) return
  const commands = await vscode.commands.getCommands(true)
  if (commands.includes(CLAUDE_OPEN_LAST)) {
    await vscode.commands.executeCommand(CLAUDE_OPEN_LAST)
  }
}

/** Fire-and-forget at activation; each half is independent and both swallow their failures. */
function reopenOnStartup(context) {
  const storageDir = context.globalStorageUri && context.globalStorageUri.fsPath
  if (storageDir) reopenOwnSession(storageDir).catch(() => {})
  reopenClaudePanel().catch(() => {})
}

module.exports = { reopenOnStartup }
