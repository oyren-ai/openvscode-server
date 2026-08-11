// activeResponseCallback for a session whose turn is RUNNING when its editor opens (docs/plans/
// vscode-agent-session-history-client.md "Content provider"): seed the server's accumulated visible
// markdown, then tail the session-local indexed stream STRICTLY after its cursor — so every delta
// renders exactly once, across any number of open/close/reopen cycles of the same editor.
//
// Wire shape (runtime agentStream.js, mode=indexed): first {"type":"hello","boot":<id>,"last":<n>},
// then {"n":<idx>,"line":"<raw ndjson>"}. Dedupe is by (boot, session, n) via sessionState — a
// server reboot changes `boot`, which legitimately resets the counter.
const { foldLine, chatSink } = require("./renderStream")

function makeActiveReplay({ sessionClient, state, id, active }) {
  return (stream, token) => {
    const sink = chatSink(stream)
    if (typeof active.markdown === "string" && active.markdown) sink.text(active.markdown)
    let boot = null
    let sub = null
    return new Promise((resolve) => {
      // `finished` covers a result line delivered before streamResponse even returns — the tail
      // handle may not exist yet when the fold says stop.
      let tail = null
      let finished = false
      const finish = () => { finished = true; if (tail) tail.cancel(); resolve() }
      tail = sessionClient.streamResponse(id, Number(active.cursor) || 0, (frame) => {
        if (frame && frame.type === "hello") { boot = frame.boot; return }
        if (!frame || typeof frame.n !== "number" || typeof frame.line !== "string") return
        if (!state.admitLine(id, boot, frame.n)) return // already rendered by an earlier open
        let line
        try { line = JSON.parse(frame.line) } catch { return } // raw junk must not kill the replay
        if (foldLine(line, sink)) finish() // its OWN result ends this response
      })
      if (finished) tail.cancel()
      sub = token.onCancellationRequested(finish)
      // A dropped tail keeps what already rendered and ends the active response quietly — the next
      // open re-fetches history; silently switching engines is exactly what must NOT happen.
      tail.done.then(resolve, resolve)
    }).finally(() => { if (sub) sub.dispose() })
  }
}

module.exports = { makeActiveReplay }
