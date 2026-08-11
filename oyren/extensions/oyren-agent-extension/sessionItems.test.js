// The item lister's three answers: [] on legacy, the mapped list on success, the last VALIDATED
// list (or []) on a transient failure — activation never throws.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createItemLister } = require("./sessionItems")
const { createSessionState } = require("./sessionState")
const { mapCtx, fakeToken } = require("./fakes")
const fixture = require("./fixtures/sessions.json")

const lister = (state, caps, listImpls) => {
  let call = 0
  return createItemLister({
    kind: "codex-cli", state, mapCtx: mapCtx("codex-cli"),
    sessionClient: {
      getCapabilities: async () => caps,
      listSessions: () => listImpls[Math.min(call++, listImpls.length - 1)](),
    },
  })
}

test("a legacy runtime lists nothing — exactly the shipped behavior", async () => {
  const items = await lister(createSessionState(), { legacy: true }, [async () => fixture])(fakeToken())
  assert.deepEqual(items, [])
})

test("a protocol runtime lists the mapped sessions and remembers them", async () => {
  const state = createSessionState()
  const items = await lister(state, { protocol: 1 }, [async () => fixture])(fakeToken())
  assert.equal(items.length, 4) // the fixture's three malformed records skipped one by one
  assert.equal(items[0].label, "Refactor the auth flow") // server order kept
  assert.equal(state.lastKnownItems("codex-cli"), items)
})

test("a transient refresh failure serves the last validated list, not a blank view", async () => {
  const state = createSessionState()
  const list = lister(state, { protocol: 1 }, [async () => fixture, async () => { throw new Error("ECONNREFUSED") }])
  const first = await list(fakeToken())
  const second = await list(fakeToken())
  assert.equal(second, first)
})

test("a fresh process with nothing cached returns [] rather than throwing", async () => {
  const items = await lister(createSessionState(), { protocol: 1 }, [async () => { throw new Error("boom") }])(fakeToken())
  assert.deepEqual(items, [])
})

test("an unknown list protocol is a failure (serves cache/[]), never half-mapped items", async () => {
  const items = await lister(createSessionState(), { protocol: 1 }, [async () => ({ ...fixture, protocol: 9 })])(fakeToken())
  assert.deepEqual(items, [])
})
