// History-to-turns mapping against the shared history fixture: chronological pairing, the
// empty-part rule, the error-once rule, whole-pair drops, and the protocol gate.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { mapHistoryTurns } = require("./historyTurns")
const { mapCtx, FakeRequestTurn, FakeResponseTurn } = require("./fakes")
const fixture = require("./fixtures/history.json")

const ctx = mapCtx("codex-cli")

test("three valid interactions become six chronological request/response turns", () => {
  const turns = mapHistoryTurns(fixture, ctx)
  assert.equal(turns.length, 6) // the malformed fourth interaction dropped WHOLE, not half
  for (let i = 0; i < turns.length; i += 2) {
    assert.ok(turns[i] instanceof FakeRequestTurn)
    assert.ok(turns[i + 1] instanceof FakeResponseTurn)
  }
  assert.equal(turns[0].prompt, "Fix the flaky workspace test")
  assert.equal(turns[0].id, "9f62245a-d5c9-42f6-8bc6-68e09828f4fa")
  assert.equal(turns[0].participant, "codex-cli") // delegated sessions lock to agent id === type
  assert.equal(turns[1].response[0].value, "I found a race in the fixture cleanup.")
})

test("empty successful markdown still gets an empty response part (stable pairing)", () => {
  const turns = mapHistoryTurns(fixture, ctx)
  assert.equal(turns[3].response.length, 1)
  assert.equal(turns[3].response[0].value, "")
  assert.deepEqual(turns[3].result, {})
})

test("an error interaction renders its markdown once and carries generic errorDetails", () => {
  const turns = mapHistoryTurns(fixture, ctx)
  const markdown = turns[5].response.map((p) => p.value).join("")
  assert.equal(markdown, "Deploying the fix…\n\nBoom: disk full")
  assert.equal(markdown.match(/Boom: disk full/g).length, 1) // server appended it; we must not again
  assert.equal(turns[5].result.errorDetails.message, "The agent reported an error.")
  assert.ok(!turns[5].result.errorDetails.message.includes("Boom")) // banner stays generic
})

test("unknown protocol or malformed document fails the read with a clear error", () => {
  assert.throws(() => mapHistoryTurns({ ...fixture, protocol: 99 }, ctx), /protocol/)
  assert.throws(() => mapHistoryTurns({ protocol: 1, interactions: null }, ctx), /array/)
})

test("unknown optional fields are ignored, not fatal", () => {
  const doc = { protocol: 1, interactions: [{ ...fixture.interactions[0], someFutureField: { deep: true } }] }
  assert.equal(mapHistoryTurns(doc, ctx).length, 2)
})
