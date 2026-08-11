// The content resolver's four answers: untitled/legacy empty sessions, restored durable history
// with model seeding, an attached active-response callback, and readable per-editor failures.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createContentResolver } = require("./sessionContent")
const { createSessionState } = require("./sessionState")
const { HttpError } = require("./agentHttp")
const { mapCtx, resource, fakeToken } = require("./fakes")
const history = require("./fixtures/history.json")

const A = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"
const meta = { protocol: 1, session: { id: A, agent: "codex-cli", model: "gpt-5-codex" } }

function resolver({ caps = { protocol: 1 }, doc = history, state = createSessionState(), fail = null } = {}) {
  const calls = { server: 0, itemFires: 0 }
  const provide = createContentResolver({
    kind: "codex-cli", state, mapCtx: mapCtx("codex-cli"), port: 8080,
    handler: async () => {},
    options: { loadModels: () => {}, knownSelection: () => ({ models: "m1" }) },
    fireItemsChanged: () => calls.itemFires++,
    sessionClient: {
      getCapabilities: async () => caps,
      getSession: async () => { calls.server++; if (fail) throw fail; return meta },
      getHistory: async () => { calls.server++; if (fail) throw fail; return doc },
      streamResponse: () => ({ done: new Promise(() => {}), cancel() {} }),
    },
  })
  return { provide, calls, state }
}

test("an untitled resource opens an empty, sendable session without dialing the server", async () => {
  const { provide, calls } = resolver()
  const session = await provide(resource("codex-cli", A, true), fakeToken())
  assert.deepEqual(session.history, [])
  assert.equal(typeof session.requestHandler, "function")
  assert.equal(calls.server, 0)
})

test("a legacy runtime opens every resource as today's empty session", async () => {
  const { provide, calls } = resolver({ caps: { legacy: true } })
  const session = await provide(resource("codex-cli", A), fakeToken())
  assert.deepEqual(session.history, [])
  assert.equal(calls.server, 0)
})

test("a durable resource restores mapped history and seeds the session's model", async () => {
  const { provide, state } = resolver()
  const session = await provide(resource("codex-cli", A), fakeToken())
  assert.equal(session.history.length, 6)
  assert.equal(state.modelFor(A), "gpt-5-codex") // from server metadata
  assert.equal(session.activeResponseCallback, undefined) // fixture has active: null
})

test("a running session gets an activeResponseCallback on top of completed history", async () => {
  const doc = { ...history, active: { id: "x", markdown: "Partial", cursor: 7 } }
  const session = await resolver({ doc }).provide(resource("codex-cli", A), fakeToken())
  assert.equal(session.history.length, 6) // the active response is NOT in history
  assert.equal(typeof session.activeResponseCallback, "function")
})

test("a deleted/stale session fails THIS editor readably and refreshes the list", async () => {
  const { provide, calls } = resolver({ fail: new HttpError("/agent/sessions/x", 404) })
  await assert.rejects(provide(resource("codex-cli", A), fakeToken()), /no longer exists/)
  assert.equal(calls.itemFires, 1)
})

test("a foreign resource fails with the provider named, before any server call", async () => {
  const { provide, calls } = resolver()
  await assert.rejects(provide(resource("gemini-cli", A), fakeToken()), /codex-cli/)
  assert.equal(calls.server, 0)
})

test("an unknown history protocol fails the read, not the extension", async () => {
  const { provide } = resolver({ doc: { ...history, protocol: 3 } })
  await assert.rejects(provide(resource("codex-cli", A), fakeToken()))
})
