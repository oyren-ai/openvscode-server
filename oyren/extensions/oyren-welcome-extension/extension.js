const vscode = require("vscode")
const { apiFrom, runStartup, hideBuiltInChat, AGENT_CHAT_SETTING } = require("./startup")
const { handleMessage } = require("./messages")
const { pageModel, localResourceRoots } = require("./pageModel")
const { renderPage } = require("./page")
const { LEAN_INFOVIEW_COMMAND, showLeanInfoview } = require("./lean")

/**
 * The Codespace's welcome page (owner, 2026-11-27): this Codespace's facts and every app in it, in
 * the middle of the editor. It replaces the "Welcome to Oyren" walkthrough, whose steps described the
 * retired Chat panel. The start sequence (startup.js) also hides the built-in Chat view and opens
 * Claude Code in the side bar, which is why this activates on "*": the earlier the Chat view is
 * hidden, the shorter it shows.
 *
 * One page at a time: the command reveals the open one, and a page the workbench restores after a
 * reload is adopted (or dropped, if one is already open).
 */
const VIEW_TYPE = "oyren.welcome"
let panel = null

function activate(context) {
  const api = apiFrom(vscode, context)
  const show = () => showPanel(context, api)
  context.subscriptions.push(
    vscode.commands.registerCommand("oyren.welcome.open", show),
    // The Lean 4 card's step (editorApps.js); not in the Command Palette.
    vscode.commands.registerCommand(LEAN_INFOVIEW_COMMAND, () => showLeanInfoview(api)),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (restored) => adopt(context, api, restored),
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(AGENT_CHAT_SETTING)) void hideBuiltInChat(api)
    }),
  )
  runStartup(api, async () => show()).catch((err) => console.error(`oyren-welcome: start failed: ${err && err.message}`))
}

function options(context) {
  return { enableScripts: true, enableCommandUris: false, localResourceRoots: localResourceRoots(vscode, context) }
}

function showPanel(context, api) {
  if (panel) return panel.reveal(vscode.ViewColumn.One)
  adopt(context, api, vscode.window.createWebviewPanel(VIEW_TYPE, "Welcome", vscode.ViewColumn.One, options(context)))
}

function adopt(context, api, created) {
  if (panel && panel !== created) return created.dispose()
  panel = created
  const media = (name) => vscode.Uri.joinPath(context.extensionUri, "media", name)
  created.iconPath = { light: media("oyren-light.svg"), dark: media("oyren-dark.svg") }
  created.webview.options = options(context)
  created.webview.html = renderPage(pageModel({ vscode, context, webview: created.webview, showOnStartup: api.showOnStartup() }))
  created.webview.onDidReceiveMessage((message) => {
    handleMessage(api, message, saveShowOnStartup).catch((err) => {
      // A save that fails (a user settings.json with a syntax error, say): say so, and put the box back.
      void vscode.window.showErrorMessage(`Oyren Welcome could not save the setting: ${err && err.message}`)
      void created.webview.postMessage({ type: "showOnStartup", value: api.showOnStartup() })
    })
  }, null, context.subscriptions)
  created.onDidDispose(() => { if (panel === created) panel = null }, null, context.subscriptions)
}

function saveShowOnStartup(value) {
  return vscode.workspace.getConfiguration("oyren.welcome").update("showOnStartup", value, vscode.ConfigurationTarget.Global)
}

function deactivate() {}

module.exports = { activate, deactivate }
