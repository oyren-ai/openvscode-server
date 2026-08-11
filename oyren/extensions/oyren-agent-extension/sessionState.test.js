// Isolation rules for the per-session state maps: everything keyed by durable UUID, nothing leaks
// between sessions, and the single-flight create stays retryable after failure.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createSessionState } = require("./sessionState")

const A = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"
const B = "0f0e0d0c-0b0a-4a4b-8c8d-1e1f2a2b3c3d"

test("busy latches are per session: A running never blocks B", () => {
  const s = createSessionState()
  assert.equal(s.tryStartTurn(A), true)
  assert.equal(s.tryStartTurn(A), false) // same-session overlap blocked
  assert.equal(s.tryStartTurn(B), true) // sibling proceeds
  s.endTurn(A)
  assert.equal(s.isBusy(A), false)
  assert.equal(s.isBusy(B), true) // ending A touched only A
})

test("model selection is per session", () => {
  const s = createSessionState()
  s.setModel(A, "gpt-5-codex")
  s.setModel(B, "o4-mini")
  assert.equal(s.modelFor(A), "gpt-5-codex")
  assert.equal(s.modelFor(B), "o4-mini")
  assert.equal(s.modelFor("c0ffee00-0000-4000-8000-000000000000"), null)
})

test("admitLine passes each (boot, session, n) exactly once, per session", () => {
  const s = createSessionState()
  assert.equal(s.admitLine(A, "boot1", 5), true)
  assert.equal(s.admitLine(A, "boot1", 5), false) // duplicate replay
  assert.equal(s.admitLine(A, "boot1", 4), false) // stale index
  assert.equal(s.admitLine(A, "boot1", 6), true)
  assert.equal(s.admitLine(B, "boot1", 5), true) // B's cursor is B's alone
  assert.equal(s.admitLine(A, "boot2", 1), true) // server reboot resets legitimately
})

test("item cache serves the last VALIDATED list per kind", () => {
  const s = createSessionState()
  assert.equal(s.lastKnownItems("codex-cli"), null) // fresh process: caller renders []
  s.rememberItems("codex-cli", [{ label: "x" }])
  assert.deepEqual(s.lastKnownItems("codex-cli"), [{ label: "x" }])
  assert.equal(s.lastKnownItems("gemini-cli"), null)
})

test("createOnce: concurrent callers share one attempt; success stays; failure clears", async () => {
  const s = createSessionState()
  let runs = 0
  const fn = () => { runs++; return Promise.resolve({ id: A }) }
  const [first, second] = await Promise.all([s.createOnce(A, fn), s.createOnce(A, fn)])
  assert.equal(runs, 1)
  assert.equal(first, second)
  await s.createOnce(A, fn)
  assert.equal(runs, 1) // success is cached — a later send reuses the settled result

  let failures = 0
  const failing = () => { failures++; return Promise.reject(new Error("server said no")) }
  await assert.rejects(s.createOnce(B, failing))
  await assert.rejects(s.createOnce(B, failing))
  assert.equal(failures, 2) // failure cleared the slot: the untitled editor stays retryable
})
