// The handler's two paths: legacy stays byte-for-byte (default participant, old runtimes), the
// session path scopes busy/model/cancel to ONE durable UUID and pins the first turn's message id.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { makeHandler } = require("./turnHandler")
const { createSessionState } = require("./sessionState")
const { collector, fakeToken, resource } = require("./fakes")

const A = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"

const legacyClient = () => {
  const calls = { turns: [], interrupts: 0 }
  return { calls, token: "t", port: 8080, state: { busy: false, currentModel: null, modelsLive: true },
    ensureModel: async () => {}, interrupt: async () => calls.interrupts++,
    streamTurn: (text, onLine) => { calls.turns.push(text); onLine({ type: "result" }); return { done: Promise.resolve(), cancel() {} } } }
}

const sessionCtx = (state, caps = { protocol: 1 }, slow = false) => {
  const calls = { turns: [], interrupts: [], models: [], creates: 0 }
  const ctx = { kind: "codex-cli", state,
    sessionClient: {
      getCapabilities: async () => caps,
      setModel: async (id, m) => calls.models.push([id, m]),
      interrupt: async (id) => calls.interrupts.push(id),
      streamTurn: (id, text, msgId, onLine) => {
        calls.turns.push({ id, text, msgId })
        if (!slow) onLine({ type: "result" })
        return { done: slow ? new Promise((r) => setTimeout(r, 20)) : Promise.resolve(), cancel() {} }
      } },
    ensureDurable: async () => { calls.creates++; return { id: A, firstMessageId: "first-1" } } }
  return { calls, ctx }
}
const context = { chatSessionContext: { chatSessionItem: { resource: resource("codex-cli", A) }, isUntitled: false } }

test("default participant: legacy client, no session machinery touched", async () => {
  const client = legacyClient()
  await makeHandler(client)({ prompt: "hi" }, {}, collector().stream, fakeToken())
  assert.deepEqual(client.calls.turns, ["hi"])
})

test("empty prompt renders guidance and never creates or sends", async () => {
  const client = legacyClient()
  const { calls, ctx } = sessionCtx(createSessionState())
  const { out, stream } = collector()
  await makeHandler(client, ctx)({ prompt: "   " }, context, stream, fakeToken())
  assert.match(out.text.join(""), /nothing to send/)
  assert.equal(calls.creates + calls.turns.length + client.calls.turns.length, 0)
})

test("protocol runtime: the turn carries the durable id and the pinned first message id", async () => {
  const client = legacyClient()
  const { calls, ctx } = sessionCtx(createSessionState())
  await makeHandler(client, ctx)({ prompt: "run it" }, context, collector().stream, fakeToken())
  assert.deepEqual(calls.turns, [{ id: A, text: "run it", msgId: "first-1" }])
  assert.equal(client.calls.turns.length, 0) // never the parameter-free path
})

test("legacy runtime (capability 404): delegated sends keep today's parameter-free path", async () => {
  const client = legacyClient()
  const { calls, ctx } = sessionCtx(createSessionState(), { legacy: true })
  await makeHandler(client, ctx)({ prompt: "hi" }, context, collector().stream, fakeToken())
  assert.deepEqual(client.calls.turns, ["hi"])
  assert.equal(calls.turns.length + calls.creates, 0) // no fake durable items, no session params
})

test("same-session overlap is blocked; the latch clears after the turn", async () => {
  const state = createSessionState()
  const { calls, ctx } = sessionCtx(state)
  const handler = makeHandler(legacyClient(), ctx)
  state.tryStartTurn(A) // a turn is already running in THIS chat
  const { out, stream } = collector()
  await handler({ prompt: "again" }, context, stream, fakeToken())
  assert.match(out.text.join(""), /already running in this chat/)
  assert.equal(calls.turns.length, 0)
  state.endTurn(A)
  await handler({ prompt: "now" }, context, collector().stream, fakeToken())
  assert.equal(calls.turns.length, 1)
  assert.equal(state.isBusy(A), false)
})

test("cancellation interrupts exactly this kind/session pair", async () => {
  const { calls, ctx } = sessionCtx(createSessionState(), { protocol: 1 }, true)
  const token = fakeToken()
  const running = makeHandler(legacyClient(), ctx)({ prompt: "long job" }, context, collector().stream, token)
  await new Promise((r) => setTimeout(r, 5))
  token.fire()
  await running
  assert.deepEqual(calls.interrupts, [A])
})

test("a picked model posts once per change, scoped to the session", async () => {
  const state = createSessionState()
  const { calls, ctx } = sessionCtx(state)
  const handler = makeHandler(legacyClient(), ctx)
  const request = { prompt: "go", model: { vendor: "oyren", id: "m2" } }
  await handler(request, context, collector().stream, fakeToken())
  await handler(request, context, collector().stream, fakeToken())
  assert.deepEqual(calls.models, [[A, "m2"]]) // the echo of an unchanged model never re-posts
  assert.equal(state.modelFor(A), "m2")
})
