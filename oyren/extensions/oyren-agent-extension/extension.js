const vscode = require("vscode")
const { SETTING_SECTION, agentChatEnabled } = require("./agentChatGate")
const { createClient } = require("./agentClient")
const { makeHandler } = require("./turnHandler")
const { createModelProvider } = require("./modelProvider")
const { registerSessionProviders } = require("./sessionProviders")

/**
 * The production successor to oyren-chat-probe: VS Code's built-in Chat view, backed by the sandbox
 * agent for ALL seven providers (docs/oyren-chat-participant.md). The extension host runs inside the
 * droplet, so it dials the runtime directly on 127.0.0.1 — no CORS, no trip through the edge.
 *
 * The chat is off by default since 2026-11-27 (agentChatGate.js): with oyren.agentChat.enabled
 * unset, activation registers none of it (the participant, the model vendor, the session types),
 * matching the manifest's when clauses. Only the chat waits for the setting. Anything else this
 * extension registers, such as the terminal image paste, registers whatever the setting says, so
 * activate() never returns early (extension.test.js).
 *
 * Registration is wrapped, never thrown: a thrown activation is indistinguishable from the Chat view
 * simply being absent, and the two failures have completely different fixes.
 */

function activate(context) {
  const chatOn = agentChatEnabled(vscode.workspace.getConfiguration(SETTING_SECTION))
  const client = chatOn ? createClient() : null

  if (chatOn && vscode.chat && typeof vscode.chat.createChatParticipant === "function") {
    try {
      context.subscriptions.push(vscode.chat.createChatParticipant("oyren.agent", makeHandler(client)))
    } catch (err) {
      console.error(`oyren-agent: participant registration failed: ${err && err.message}`)
    }
  }

  // The model picker path. Registered even with no session token: the provider's fallback model is
  // what keeps the picker populated on a self-hosted editor instead of an empty, nagging dropdown.
  if (chatOn && vscode.lm && typeof vscode.lm.registerLanguageModelChatProvider === "function") {
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

  // The agent-type dropdown: one chat session per CLI agent, on our patched build.
  if (chatOn) registerSessionProviders(context)
}

function deactivate() {}

module.exports = { activate, deactivate }
