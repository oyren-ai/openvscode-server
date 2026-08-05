// Folds the runtime's stream-json ndjson lines (sandbox-runtime/src/acp/translate.js emits these
// shapes; the Claude SDK engine speaks them natively) into a sink with two channels:
//   text(t)     — user-visible output, streamed as it arrives
//   progress(m) — transient status ("Running Bash…"), shown only while the turn is live
// The sink indirection is what lets ONE folder serve both consumers: the chat participant
// (stream.markdown / stream.progress) and the language-model provider (text parts only).

/** Fold one parsed line. Returns true when the line ends the turn (a `result`), else false.
 *  The server does close the socket right after `result`, but ending on the line itself means a
 *  socket that lingers can never hang a chat turn. */
function foldLine(line, sink) {
  if (!line || typeof line !== "object") return false
  if (line.type === "stream_event") return foldEvent(line.event, sink)
  if (line.type === "assistant") return foldAssistant(line.message, sink)
  if (line.type === "result") return foldResult(line, sink)
  // Everything else — user tool_results (already summarized by their tool_use), ping keepalives,
  // user_message echoes, future types — renders nothing. The wire grows line types faster than this
  // extension ships, so unknown must mean silence, not breakage.
  return false
}

/** Streamed deltas: text renders incrementally; thinking stays private; bookkeeping renders nothing. */
function foldEvent(event, sink) {
  const delta = event && event.type === "content_block_delta" ? event.delta : null
  if (delta && delta.type === "text_delta" && delta.text) sink.text(delta.text)
  return false
}

// The consolidated assistant line re-carries text ALREADY streamed as deltas under the same message
// id — the rich frontend upserts by id, but a ChatResponseStream is append-only, so text blocks are
// skipped here or every answer would render twice. tool_use blocks only ever arrive on this line.
function foldAssistant(message, sink) {
  const content = message && Array.isArray(message.content) ? message.content : []
  for (const block of content) {
    if (block && block.type === "tool_use") sink.progress(`Running ${block.name || "tool"}…`)
  }
  return false
}

/** `result` ends the turn; only the error variant has anything left to say. */
function foldResult(line, sink) {
  if (line.is_error) sink.text(`\n\n${line.error || "The agent reported an error."}`)
  return true
}

/** The participant-side sink over a ChatResponseStream. */
const chatSink = (stream) => ({ text: (t) => stream.markdown(t), progress: (m) => stream.progress(m) })

module.exports = { foldLine, chatSink }
