// Per-RESOURCE half of the session model picker (the per-KIND list half stays in
// sessionOptions.js): which value a given chat resource shows, and where a picked value goes.
// Pure module — `cache` is sessionOptions' kind-level list cache, `aware` carries
// { state, sessionClient } on a protocol-capable wiring and is null for legacy-only use.
const { parseSessionResource } = require("./sessionResource")

function createModelSelection(client, kind, cache, aware) {
  const idFor = (resource) => {
    const p = aware && parseSessionResource(resource, kind)
    return p ? p.id : null // untitled already derives its durable UUID — a pre-create pick survives the commit
  }

  /** This resource's picker value: its own session model while it's still a real list entry, else
   *  the kind's current. A vanished historical model shows in the item description instead — the
   *  picker must only ever hold a valid, postable id. */
  const selectionFor = (resource) => {
    const id = idFor(resource)
    const mine = id && aware.state.modelFor(id)
    return mine && cache.models.some((m) => m.value === mine) ? mine : cache.current
  }

  /** Route one picked model: per-session on a protocol runtime (posted with agent+session, stored
   *  under the durable UUID — session A can never update session B), legacy per-kind otherwise. An
   *  untitled session only STORES the pick; the create carries it to the server. */
  async function applyChoice(resource, chosen) {
    const parsed = aware ? parseSessionResource(resource, kind) : null
    const caps = parsed ? await aware.sessionClient.getCapabilities().catch(() => ({ legacy: true })) : { legacy: true }
    if (!parsed || caps.legacy) { cache.current = chosen; return client.ensureModel(chosen).catch(() => {}) }
    if (aware.state.modelFor(parsed.id) === chosen) return // our own fire echoing back — already applied
    aware.state.setModel(parsed.id, chosen)
    if (!parsed.untitled) await aware.sessionClient.setModel(parsed.id, chosen).catch(() => {}) // best-effort, like legacy
  }

  return { selectionFor, applyChoice }
}

module.exports = { createModelSelection }
