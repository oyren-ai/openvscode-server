// Metadata mapping against the shared sessions fixture: the status/timing table, safe metadata,
// model-as-description, and the skip-one-bad-record rule.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { mapSessionItem, mapSessionList } = require("./sessionMapper")
const { mapCtx } = require("./fakes")
const fixture = require("./fixtures/sessions.json")

const ctx = mapCtx("codex-cli")
const at = (iso) => Date.parse(iso)

test("the fixture list keeps exactly the four valid records, in server order", () => {
  const items = mapSessionList(fixture, ctx)
  assert.deepEqual(items.map((i) => i.metadata.id), [
    "0f0e0d0c-0b0a-4a4b-8c8d-1e1f2a2b3c3d", "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea",
    "11111111-2222-4333-8444-555555555555", "99999999-8888-4777-8666-555544443333",
  ])
})

test("status and timing map per the plan's table", () => {
  const [running, completed, failed, empty] = mapSessionList(fixture, ctx)
  assert.equal(running.status, "inProgress")
  assert.deepEqual(running.timing, { created: at("2026-08-10T09:00:00.000Z"), lastRequestStarted: at("2026-08-10T09:01:00.000Z") })
  assert.equal(completed.status, "completed")
  assert.deepEqual(completed.timing, {
    created: at("2026-08-09T12:00:00.000Z"),
    lastRequestStarted: at("2026-08-09T12:03:00.000Z"), lastRequestEnded: at("2026-08-09T12:04:00.000Z"),
  })
  assert.equal(failed.status, "failed")
  assert.equal(failed.timing.lastRequestEnded, at("2026-08-08T08:02:00.000Z"))
  // `empty` renders settled with created only — even though the server sent a start timestamp.
  assert.equal(empty.status, "completed")
  assert.deepEqual(empty.timing, { created: at("2026-08-11T10:00:00.000Z") })
})

test("timing values are millisecond numbers, never Date instances", () => {
  for (const item of mapSessionList(fixture, ctx))
    for (const v of Object.values(item.timing)) assert.equal(typeof v, "number")
})

test("label, resource, model description, and safe metadata", () => {
  const item = mapSessionList(fixture, ctx)[1]
  assert.equal(item.label, "Fix the flaky workspace test")
  assert.deepEqual(item.resource, ctx.resourceFor("6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"))
  assert.equal(item.description, "gpt-5-codex")
  // ONLY the four public fields — no timestamps, prompts, or server internals ride along.
  assert.deepEqual(item.metadata, { protocol: 1, id: "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea", agent: "codex-cli", model: "gpt-5-codex" })
})

test("a record without a model has no description and a null metadata model", () => {
  const failed = mapSessionList(fixture, ctx)[2]
  assert.equal(failed.description, undefined)
  assert.equal(failed.metadata.model, null)
})

test("single bad records map to null (skipped), not throws", () => {
  assert.equal(mapSessionItem(fixture.sessions[4], ctx), null) // non-canonical id
  assert.equal(mapSessionItem(fixture.sessions[5], ctx), null) // wrong kind
  assert.equal(mapSessionItem(fixture.sessions[6], ctx), null) // missing label
  assert.equal(mapSessionItem({ ...fixture.sessions[0], status: "exploded" }, ctx), null) // unknown status
})

test("an unknown protocol fails the WHOLE list loudly", () => {
  assert.throws(() => mapSessionList({ ...fixture, protocol: 2 }, ctx), /protocol/)
  assert.throws(() => mapSessionList({ protocol: 1, sessions: "nope" }, ctx), /array/)
})
