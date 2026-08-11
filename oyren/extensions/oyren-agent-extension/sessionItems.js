// provideChatSessionItems for one kind (docs/plans/vscode-agent-session-history-client.md "Item
// provider"): capability-gate, list from the server, map, remember. Never merges kinds, never
// reorders (the server sorts newest-first), never spawns an agent — GET /agent/sessions is
// metadata-only by contract. Pure module; vscode arrives through mapCtx.
const { mapSessionList } = require("./sessionMapper")

function createItemLister({ kind, sessionClient, state, mapCtx }) {
  return async function provideChatSessionItems(cancelToken) {
    // Legacy runtime (capability 404): no enumerable history — the exact shipped behavior. A
    // TRANSIENT capability failure lands here too, uncached, so the next list retries for real.
    const caps = await sessionClient.getCapabilities(cancelToken).catch(() => ({ legacy: true }))
    if (caps.legacy) return []
    try {
      const items = mapSessionList(await sessionClient.listSessions(cancelToken), mapCtx)
      state.rememberItems(kind, items)
      return items
    } catch (err) {
      // One content-free line (kind + status/message from our own HttpError — never a body), then
      // the last VALIDATED list for this process; a fresh process serves [] rather than throwing
      // during activation. mapSessionList already dropped malformed records one by one.
      console.error(`oyren-agent: session list for ${kind} failed: ${err && err.message}`)
      return state.lastKnownItems(kind) || []
    }
  }
}

module.exports = { createItemLister }
