// What the editor does as it starts, in order (owner, 2026-11-27):
//   1. Hide the built-in Chat view, unless the Oyren Agent chat is switched back on.
//   2. On a workspace's first start, open the side bar's default tool: Claude Code, else Codex.
//   3. Open the welcome page into an empty editor area, unless the user switched that off.
//
// 1 uses the core context key chatSetupHidden. The Chat view's when clause (this fork's
// src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts) shows the view unless chat
// setup is hidden or disabled, or shows it anyway while a default participant is registered. Our
// product has no defaultChatAgent, so ChatEntitlementService returns before it binds those keys and
// nothing else writes chatSetupHidden. Setting it through the public setContext command hides the view
// and the chat entry points keyed on it; with the Oyren participant gated off (oyren-agent-extension),
// the view's container (hideIfEmpty) leaves the secondary side bar. The extension activates on "*"
// so this lands as early as the extension host allows; until then the workbench may show the view.
const { SIDE_BAR_DEFAULTS, editorApp } = require("./editorApps")

const CHAT_HIDDEN = "chatSetupHidden"
// The agent extension's switch (oyren-agent-extension/agentChatGate.js; startup.test.js keeps the two
// spellings the same).
const AGENT_CHAT_SECTION = "oyren"
const AGENT_CHAT_KEY = "agentChat.enabled"
const AGENT_CHAT_SETTING = `${AGENT_CHAT_SECTION}.${AGENT_CHAT_KEY}`
// Workspace-scoped: a fresh Codespace defaults once, and a later pick of another tool is kept.
const SIDE_BAR_LATCH = "oyren.welcome.sideBarDefaulted"

/** Run the first step that succeeds; a command that is missing or throws moves on to the next. */
async function runFirst(api, steps) {
  for (const { command, args = [] } of steps) {
    try {
      await api.executeCommand(command, ...args)
      return command
    } catch {
      // not registered on this build or version: try the next step
    }
  }
  return null
}

function hideBuiltInChat(api) {
  return api.executeCommand("setContext", CHAT_HIDDEN, !api.agentChatEnabled())
}

async function defaultSideBar(api) {
  if (api.agentChatEnabled() || api.workspaceState.get(SIDE_BAR_LATCH)) return null
  for (const id of SIDE_BAR_DEFAULTS) {
    const app = editorApp(id)
    if (!api.hasExtension(app.extension)) continue
    if (await runFirst(api, app.run)) {
      await api.workspaceState.update(SIDE_BAR_LATCH, true)
      return id
    }
  }
  return null
}

// The stock Welcome page, or the "Setup VS Code Web" walkthrough it turns into on a fresh browser. The
// web workbench opens it at first paint, before the remote settings that say startupEditor "none"
// have arrived (seen on dev, 2026-11-27: open at 4.7 s, before any extension ran). It has no tab input
// the extension API can name; only English labels are recognised, elsewhere it simply stays open.
const isStockWelcome = (tab) => tab.input === undefined && /^(Welcome|Walkthrough: )/.test(tab.label)

/** Open the page into an empty editor area, replacing the stock Welcome page; the user's own editors win. */
async function openOnStartup(api, openWelcome) {
  if (!api.showOnStartup()) return
  const tabs = api.tabGroups.all.flatMap((group) => group.tabs)
  const stock = tabs.filter(isStockWelcome)
  if (tabs.length > stock.length) return
  if (stock.length) await api.closeTabs(stock)
  await openWelcome()
}

async function runStartup(api, openWelcome) {
  await hideBuiltInChat(api)
  await defaultSideBar(api)
  await openOnStartup(api, openWelcome)
}

/** The slice of the vscode API the start needs, so the tests can hand in a fake. */
function apiFrom(vscode, context) {
  return {
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    hasExtension: (id) => Boolean(vscode.extensions.getExtension(id)),
    agentChatEnabled: () => vscode.workspace.getConfiguration(AGENT_CHAT_SECTION).get(AGENT_CHAT_KEY, false) === true,
    showOnStartup: () => vscode.workspace.getConfiguration("oyren.welcome").get("showOnStartup", true) !== false,
    tabGroups: vscode.window.tabGroups,
    closeTabs: (tabs) => vscode.window.tabGroups.close(tabs),
    visibleTextEditors: () => vscode.window.visibleTextEditors,
    showTextDocument: (target, options) => vscode.window.showTextDocument(target, options),
    workspaceState: context.workspaceState,
  }
}

module.exports = { runStartup, runFirst, hideBuiltInChat, apiFrom, SIDE_BAR_LATCH, AGENT_CHAT_SETTING }
