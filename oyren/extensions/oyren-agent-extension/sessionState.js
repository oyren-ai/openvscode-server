// Per-SESSION mutable state, keyed by durable logical UUID — the replacement for the old one-latch-
// per-kind world (docs/plans/vscode-agent-session-history-client.md "Per-session interaction
// state"). One instance serves the whole extension; everything here is in-memory, non-authoritative
// UI state — the next successful server read replaces it, and none of it is a transcript store.
// Pure module: no vscode, no HTTP — just the maps, so isolation rules are unit-testable.

function createSessionState() {
  const busy = new Set() // session UUIDs with a running turn — blocks a SECOND turn in the SAME session only
  const models = new Map() // session UUID → currently selected model id (seeded from server metadata)
  const cursors = new Map() // session UUID → { boot, last } — indexed-stream dedupe by (boot, session, n)
  const lastItems = new Map() // kind → last VALIDATED item list, served when a refresh fails transiently
  const creates = new Map() // durable UUID → in-flight/settled create promise (untitled single-flight)

  return {
    /** One turn at a time per session; separate sessions of one kind proceed independently (the
     *  server still owns the real cap and can answer 409 session_busy). */
    tryStartTurn: (id) => (busy.has(id) ? false : (busy.add(id), true)),
    endTurn: (id) => { busy.delete(id) },
    isBusy: (id) => busy.has(id),

    modelFor: (id) => models.get(id) ?? null,
    setModel: (id, model) => { models.set(id, model) }, // session A's pick can never touch session B: distinct keys

    /** Indexed-line gate: true exactly once per (boot, session, n). A server reboot changes `boot`,
     *  which resets the cursor — old indexes must not mask the new stream. */
    admitLine: (id, boot, n) => {
      const c = cursors.get(id)
      if (c && c.boot === boot && n <= c.last) return false
      cursors.set(id, { boot, last: c && c.boot === boot ? Math.max(c.last, n) : n })
      return true
    },
    cursorFor: (id) => cursors.get(id) ?? null,

    /** Last-known list per kind: a transient refresh failure serves this instead of blanking the
     *  view; a fresh process with nothing cached serves [] rather than throwing during activation. */
    rememberItems: (kind, items) => { lastItems.set(kind, items) },
    lastKnownItems: (kind) => lastItems.get(kind) ?? null,

    /** Single-flight create per durable UUID (derived from the untitled UUID, so a retried first
     *  send lands on the SAME entry). Success stays cached — later callers reuse the settled result;
     *  failure clears, so the untitled editor remains retryable instead of poisoned. */
    createOnce: (id, fn) => {
      let p = creates.get(id)
      if (p) return p
      p = Promise.resolve().then(fn)
      creates.set(id, p)
      p.catch(() => { if (creates.get(id) === p) creates.delete(id) })
      return p
    },
  }
}

module.exports = { createSessionState }
