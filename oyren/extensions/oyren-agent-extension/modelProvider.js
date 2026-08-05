// The vendor "oyren" language-model provider. The chat input's model picker is populated by lm
// providers, NOT participants — without this registration the picker is empty. Models come from
// GET /agent/models; the response method is a minimal passthrough of the same /agent/message stream
// so a direct vscode.lm consumer gets text back instead of a crash.
const vscode = require("vscode")
const { foldLine } = require("./renderStream")

// Required numeric fields on LanguageModelChatInformation. The engine never sees them — they only
// inform the UI — so rough, generous values beat pretending we know each provider's real limits.
const LIMITS = { maxInputTokens: 200000, maxOutputTokens: 64000 }

const information = (id, name, isDefault) => ({
  id,
  name,
  family: "oyren",
  version: "1.0.0",
  ...LIMITS,
  // toolCalling is REQUIRED, not aspirational: in Agent and Edit modes the picker filters to
  // toolCalling-capable models (languageModels.ts suitableForAgentMode) — without it the list is
  // empty and the picker shows a dead synthetic "Auto". It is also true: these "models" are agent
  // engines that run tools, engine-side.
  capabilities: { toolCalling: true },
  isUserSelectable: true, // proposed (chatProvider): without it the picker hides the model
  isDefault,
})

/** The newest User message's text. The passthrough sends ONE turn — the persistent session already
 *  holds its own history, so replaying the transcript would duplicate it into the agent's context. */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== vscode.LanguageModelChatMessageRole.User) continue
    const parts = (messages[i].content || []).map((p) => (p && typeof p.value === "string" ? p.value : ""))
    const text = parts.filter(Boolean).join("\n")
    if (text) return text
  }
  return ""
}

function createModelProvider(client) {
  return {
    async provideLanguageModelChatInformation(_options, _cancelToken) {
      let models = []
      try { if (client.token) models = await client.listModels() } catch { /* offline → fallback */ }
      // The fallback keeps the picker (and the view behind it) alive with no agent attached; its id
      // is never posted back — ensureModel refuses to switch while /agent/models has not answered.
      if (!models.length) return [information("auto", "Session agent", true)]
      return models.map((m, i) =>
        information(m.value, m.displayName || m.value, m.value === client.state.currentModel || (i === 0 && !client.state.currentModel)))
    },

    async provideLanguageModelChatResponse(model, messages, _options, progress, cancelToken) {
      const say = (text) => progress.report(new vscode.LanguageModelTextPart(text))
      if (!client.token) return void say("There is no sandbox agent attached to this editor.")
      if (client.state.busy) return void say("A turn is already running in this session.")
      client.state.busy = true
      const sink = { text: say, progress: () => {} } // tool lines have no lm response part: drop, don't crash
      try {
        await client.ensureModel(model && model.id)
        const turn = client.streamTurn(lastUserText(messages), (line) => { if (foldLine(line, sink)) turn.cancel() })
        const sub = cancelToken.onCancellationRequested(() => { client.interrupt().catch(() => {}); turn.cancel() })
        try { await turn.done } finally { sub.dispose() }
      } catch {
        say(`The sandbox agent isn't reachable on 127.0.0.1:${client.port}.`)
      } finally {
        client.state.busy = false
      }
    },

    /** ≈4 chars/token. The engine tokenizes for real; this only feeds the UI's quota estimates. */
    async provideTokenCount(_model, text, _cancelToken) {
      const s = typeof text === "string" ? text : JSON.stringify((text && text.content) || "")
      return Math.ceil(s.length / 4)
    },
  }
}

module.exports = { createModelProvider }
