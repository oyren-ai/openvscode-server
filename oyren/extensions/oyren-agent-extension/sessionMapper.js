// Server session metadata → ChatSessionItem, and nothing else: provider registration keeps zero
// schema knowledge (docs/plans/vscode-agent-session-history-client.md "Item provider"). Pure module —
// the vscode-owned pieces (Uri, the ChatSessionStatus enum) arrive injected via `ctx`, so tests run
// under plain `node --test` with fakes.
//
// ctx = {
//   kind:        the provider's agent kind — a record for another kind is a server bug, skip it
//   resourceFor: (id) => Uri for the durable resource
//   statuses:    { failed, completed, inProgress }  — vscode.ChatSessionStatus members
// }
const { isCanonicalUuid } = require("./sessionResource")

const PROTOCOL = 1

// Server → VS Code status. `empty` renders Completed: a created-but-unspoken session is settled, not
// running, and InProgress would animate a spinner over nothing.
const STATUS = { empty: "completed", in_progress: "inProgress", completed: "completed", failed: "failed" }

const ms = (iso) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : undefined // timing wants millisecond numbers, never Date instances
}

/** One metadata record → one item, or null when the record can't be trusted. Nulls are the caller's
 *  cue to SKIP — one malformed record must not hide every other session. */
function mapSessionItem(record, ctx) {
  if (!record || typeof record !== "object") return null
  if (!isCanonicalUuid(record.id) || record.agent !== ctx.kind) return null
  if (typeof record.label !== "string" || !record.label) return null
  const status = STATUS[record.status]
  if (!status) return null
  const created = ms(record.createdAt)
  if (created === undefined) return null

  const timing = { created }
  const started = ms(record.lastRequestStartedAt)
  const ended = ms(record.lastRequestEndedAt)
  // Per the plan's table: `empty` carries created only; a running session has no end yet.
  if (record.status !== "empty" && started !== undefined) timing.lastRequestStarted = started
  if ((record.status === "completed" || record.status === "failed") && ended !== undefined) timing.lastRequestEnded = ended

  const item = {
    resource: ctx.resourceFor(record.id),
    label: record.label,
    status: ctx.statuses[status],
    timing,
    // ONLY safe, public fields — this object round-trips through editor state. No resume ids, no
    // tokens, no prompts (the label was already server-derived from one).
    metadata: { protocol: PROTOCOL, id: record.id, agent: record.agent, model: record.model ?? null },
  }
  // The model reads as the item's description; a historical model that no longer exists still shows
  // here (readable) without being posted anywhere (the next turn picks a valid one).
  if (typeof record.model === "string" && record.model) item.description = record.model
  return item
}

/** The list payload → items in server order (newest first — the server sorts, we don't second-guess).
 *  An unknown protocol fails the whole list loudly; a bad record is skipped quietly. */
function mapSessionList(payload, ctx) {
  if (!payload || payload.protocol !== PROTOCOL) throw new Error(`unsupported sessions protocol ${payload && payload.protocol}`)
  if (!Array.isArray(payload.sessions)) throw new Error("sessions list is not an array")
  return payload.sessions.map((r) => mapSessionItem(r, ctx)).filter(Boolean)
}

module.exports = { mapSessionItem, mapSessionList, PROTOCOL }
