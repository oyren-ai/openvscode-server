// The untitled→durable state machine (docs/plans/vscode-agent-session-history-client.md
// "Untitled-to-durable state machine"). VS Code owns the untitled editor; the server owns durable
// sessions; this module is the one hand-off between them, and it happens exactly once per untitled
// resource:
//
//   first nonempty send → POST /agent/sessions → server acks a MATCHING item
//     → fire onDidCommitChatSessionItem { original, modified }  (VS Code migrates the editor)
//     → fire item-change                                        (the list gains the durable row)
//
// Single-flight via sessionState.createOnce, keyed by the durable UUID derived from the untitled
// UUID: concurrent/retried sends share one create, a FAILED create clears (stays untitled and
// retryable), and a create that succeeded while message dispatch failed replays the SAME
// firstMessageId on retry — the server dedupes by clientMessageId, so no duplicate turn. No
// compensating delete exists in protocol v1, and none is attempted.
const { randomUUID } = require("node:crypto")
const { parseSessionResource } = require("./sessionResource")
const { mapSessionItem } = require("./sessionMapper")

function createCommitMachine({ kind, sessionClient, state, mapCtx, fireCommit, fireItemsChanged }) {
  /**
   * Resolve a chat-session item to its durable session, creating server-side when untitled.
   * Returns { id, firstMessageId } — firstMessageId is non-null only for the create's first turn.
   * Throws (untitled stays untitled) when the resource is foreign or the server won't create.
   */
  async function ensureDurable(chatSessionItem, prompt) {
    const parsed = parseSessionResource(chatSessionItem && chatSessionItem.resource, kind)
    if (!parsed) throw new Error(`not a ${kind} chat session resource`)
    if (!parsed.untitled) return { id: parsed.id, firstMessageId: null }
    return state.createOnce(parsed.id, async () => {
      const firstMessageId = randomUUID()
      // The first prompt rides along ONLY so the server can derive the label; the turn itself is
      // sent separately (streamTurn) after commit.
      const out = await sessionClient.createSession({ id: parsed.id, firstMessage: prompt, model: state.modelFor(parsed.id) })
      const item = mapSessionItem(out && out.session, mapCtx)
      // Commit NOTHING until the server acked the id we asked for — a mismatched ack committed
      // locally would bind this editor to a session someone else owns.
      if (!item || out.session.id !== parsed.id) throw new Error("create answered with a mismatched session")
      fireCommit({ original: chatSessionItem, modified: item })
      fireItemsChanged()
      return { id: parsed.id, firstMessageId }
    })
  }
  return { ensureDurable }
}

module.exports = { createCommitMachine }
