// Server history document → the ChatSession.history turn array (docs/plans/
// vscode-agent-session-history-client.md "History mapping"). Pure module: the pinned-1.109 runtime
// constructors (ChatRequestTurn, ChatResponseTurn2, ChatResponseMarkdownPart) arrive injected via
// `ctx.api`, so tests run under plain `node --test` with fakes and the ONE place that touches real
// constructors is the provider wiring.
//
// The contract that matters here: `interactions` holds ONLY completed turns (the active one travels
// separately as `doc.active`, rendered via activeResponseCallback — never into history), order is
// chronological request-then-response, and the server's markdown is already the exact projection the
// user originally saw — including the readable error line for an error result, appended exactly once
// SERVER-side. So this module never re-appends error text into markdown; the error surfaces a second
// way only as result.errorDetails, which the chat renders as a banner, not as transcript.
const { PROTOCOL } = require("./sessionMapper")

/**
 * doc → array of turns, or throw for a document we must not guess at. ctx = { kind, api }.
 * A malformed interaction is dropped WHOLE (request and response together) — half a pair would
 * desync every later turn's pairing, which is worse than one missing exchange.
 */
function mapHistoryTurns(doc, ctx) {
  if (!doc || doc.protocol !== PROTOCOL) throw new Error(`unsupported history protocol ${doc && doc.protocol}`)
  if (!Array.isArray(doc.interactions)) throw new Error("history interactions is not an array")
  const { ChatRequestTurn, ChatResponseTurn2, ChatResponseMarkdownPart } = ctx.api
  const turns = []
  for (const it of doc.interactions) {
    if (!it || typeof it !== "object" || !it.request || !it.response) continue
    if (typeof it.request.text !== "string") continue
    // Markdown must be a REAL string — empty is fine (an empty part keeps request/response pairing
    // stable), absent is a record we don't understand.
    if (typeof it.response.markdown !== "string") continue
    // Positional args pinned by the plan: (prompt, command, references, participant, toolReferences,
    // editedFileEvents, id). The participant slot carries the kind — delegated sessions lock the
    // widget to agent id === session type.
    turns.push(new ChatRequestTurn(it.request.text, undefined, [], ctx.kind, [], undefined, it.id))
    turns.push(new ChatResponseTurn2(
      [new ChatResponseMarkdownPart(it.response.markdown)],
      resultFor(it.response),
      ctx.kind,
      undefined,
    ))
  }
  return turns
}

// Restored markdown stays untrusted (the server persists what streamed, not what's safe to eval);
// MarkdownString trust flags are simply never set anywhere in this path.
function resultFor(response) {
  if (response.outcome === "error") {
    // The banner text is generic ON PURPOSE: the specific error already sits in the markdown once,
    // and repeating it here would render it twice.
    return { errorDetails: { message: "The agent reported an error." } }
  }
  return {}
}

module.exports = { mapHistoryTurns }
