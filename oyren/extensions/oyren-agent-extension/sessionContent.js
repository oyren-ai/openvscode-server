// provideChatSessionContent for one kind (docs/plans/vscode-agent-session-history-client.md
// "Content provider"). Four shapes of resource, four answers:
//   untitled            → empty completed history, handler bound; the commit machine takes it from
//                         the first send (no server call here — opening a tab must stay free).
//   durable, completed  → server metadata + history mapped to turns; model seeded from metadata.
//   durable, running    → completed history PLUS activeResponseCallback (activeReplay.js).
//   unknown/foreign     → fail THIS editor with an actionable sentence — never activation.
// A legacy runtime collapses everything to the untitled answer: exactly what shipped before.
const { parseSessionResource } = require("./sessionResource")
const { mapHistoryTurns } = require("./historyTurns")
const { makeActiveReplay } = require("./activeReplay")
const { messageForError } = require("./sessionErrors")

function createContentResolver({ kind, sessionClient, state, options, handler, mapCtx, port, fireItemsChanged }) {
  return async function provideChatSessionContent(resource, cancelToken) {
    options.loadModels(resource) // per-KIND model list, lazily — opening the session loads the picker
    const caps = await sessionClient.getCapabilities(cancelToken).catch(() => ({ legacy: true }))
    const parsed = parseSessionResource(resource, kind)
    if (caps.legacy || (parsed && parsed.untitled))
      return { history: [], options: options.knownSelection(resource), requestHandler: handler }
    if (!parsed) throw new Error(`This editor does not hold a ${kind} chat session.`)
    try {
      const [meta, doc] = await Promise.all([
        sessionClient.getSession(parsed.id, cancelToken),
        sessionClient.getHistory(parsed.id, cancelToken),
      ])
      // Seed THIS resource's model from server metadata — even a model that no longer exists in the
      // list: history stays readable under it, and a valid model is chosen only at the next send.
      const model = meta && meta.session && typeof meta.session.model === "string" ? meta.session.model : null
      if (model && !state.modelFor(parsed.id)) state.setModel(parsed.id, model)
      const session = {
        history: mapHistoryTurns(doc, mapCtx), // chronological, completed only — active is separate
        options: options.knownSelection(resource),
        requestHandler: handler,
      }
      if (doc.active && typeof doc.active === "object")
        session.activeResponseCallback = makeActiveReplay({ sessionClient, state, id: parsed.id, active: doc.active })
      return session
    } catch (err) {
      // A 404 means the item under this editor went stale (server restart, retention) — refresh the
      // list so the row disappears, and fail the editor readably. Other failures fail it too; the
      // last rendered content stays wherever it is already shown, and nothing falls back to the
      // launch engine.
      if (err && err.status === 404) fireItemsChanged()
      throw new Error(messageForError(err, { kind, port }) || `This ${kind} chat could not be loaded.`)
    }
  }
}

module.exports = { createContentResolver }
