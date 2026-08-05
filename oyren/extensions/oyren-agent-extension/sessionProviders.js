// The seven agents in the chat's agent-type (monitor) dropdown. Each `chatSessions` contribution in
// package.json gets an item provider + a content provider here; picking one in the dropdown opens a
// chat session locked to that agent, whose requestHandler streams from the runtime with
// ?agent=<kind> (sideEngines.js). Same workspace files, separate conversation per agent — the
// engines cannot share a transcript, and pretending otherwise would be worse than saying so.
//
// The picker itself only lists these on our patched build (stock upstream filters contributions
// through a hardcoded allowlist); on a stock build the contributions are inert, not broken.
const vscode = require("vscode")
const { createClient } = require("./agentClient")
const { makeHandler } = require("./turnHandler")

// type = the runtime's AGENT_KIND ids, verbatim — the ?agent= value the sandbox validates against
// its spawn table. claude-code is deliberately absent: it runs launch-only (SDK engine, no ACP
// recipe), and a dropdown row that can only apologize is worse than no row.
const KINDS = [
  { type: "codex-cli", name: "codex" },
  { type: "cursor-cli", name: "cursor" },
  { type: "gemini-cli", name: "gemini" },
  { type: "opencode", name: "opencode" },
  { type: "qwen-code", name: "qwen" },
  { type: "antigravity-cli", name: "antigravity" },
]

/** Register item + content providers for every agent kind. Failures are logged, never thrown —
 *  on builds without the chatSessionsProvider proposal these APIs are simply absent. */
function registerSessionProviders(context) {
  if (!vscode.chat || typeof vscode.chat.registerChatSessionContentProvider !== "function") return
  const none = new vscode.EventEmitter()
  context.subscriptions.push(none)
  for (const { type, name } of KINDS) {
    try {
      // The session's own kind needs no ?agent= — the primary engine IS that agent. The runtime
      // rejects ?agent=<launch kind> on purpose, so route it to the plain client.
      const kind = type === (process.env.AGENT_KIND || "") ? null : type
      const client = createClient(process.env, kind)
      const participant = vscode.chat.createChatParticipant(`oyren.${name}`, makeHandler(client))
      context.subscriptions.push(participant)
      context.subscriptions.push(vscode.chat.registerChatSessionItemProvider(type, {
        onDidChangeChatSessionItems: none.event,
        // No enumerable history: side sessions live only as open editors/tabs for now.
        provideChatSessionItems: () => [],
      }))
      context.subscriptions.push(vscode.chat.registerChatSessionContentProvider(type, {
        provideChatSessionContent: () => ({ history: [], requestHandler: makeHandler(client) }),
      }, participant, { supportsInterruptions: true }))
    } catch (err) {
      console.error(`oyren-agent: session provider for ${type} failed: ${err && err.message}`)
    }
  }
}

module.exports = { registerSessionProviders, KINDS }
