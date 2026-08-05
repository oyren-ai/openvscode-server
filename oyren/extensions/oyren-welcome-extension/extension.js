const vscode = require("vscode")

/**
 * Open the Oyren walkthrough ONCE per machine, on first boot of a session's editor. globalState is
 * the right latch: it lives in the per-session server data dir, so a fresh sandbox shows the
 * walkthrough exactly once and a reload never re-opens it. The core "Setup VS Code Web" walkthrough
 * may still exist under Welcome; ours opens focused on top, which is the surface users actually see.
 */
const OPENED_KEY = "oyren.welcome.opened"
const WALKTHROUGH = "oyren.oyren-welcome#oyrenGettingStarted"

async function activate(context) {
  if (context.globalState.get(OPENED_KEY)) return
  try {
    // toSide=false: take the main editor area — this IS the onboarding surface, not a sidebar.
    await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH, false)
    await context.globalState.update(OPENED_KEY, true)
  } catch (err) {
    // A build without the walkthrough UI just skips onboarding; it must never break activation.
    console.error(`oyren-welcome: could not open walkthrough: ${err && err.message}`)
  }
}

function deactivate() {}

module.exports = { activate, deactivate }
