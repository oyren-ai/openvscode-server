// The untitled→durable machine: commit fires once, only after a MATCHING server ack; failures stay
// retryable; the first turn's clientMessageId survives a retry.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createCommitMachine } = require("./sessionCommit")
const { createSessionState } = require("./sessionState")
const { mapCtx, resource } = require("./fakes")

const A = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"
const record = (id) => ({ id, agent: "codex-cli", label: "New codex chat", status: "empty", createdAt: "2026-08-11T10:00:00.000Z" })

function machine(createImpl) {
  const calls = { create: [], commits: [], itemFires: 0 }
  const m = createCommitMachine({
    kind: "codex-cli",
    sessionClient: { createSession: (args) => { calls.create.push(args); return createImpl(args) } },
    state: createSessionState(),
    mapCtx: mapCtx("codex-cli"),
    fireCommit: (e) => calls.commits.push(e),
    fireItemsChanged: () => calls.itemFires++,
  })
  return { ...m, calls }
}

test("a durable resource never creates and has no pinned first message id", async () => {
  const { ensureDurable, calls } = machine(async ({ id }) => ({ protocol: 1, session: record(id) }))
  assert.deepEqual(await ensureDurable({ resource: resource("codex-cli", A) }, "hi"), { id: A, firstMessageId: null })
  assert.equal(calls.create.length, 0)
})

test("concurrent first sends share ONE create, ONE commit, the SAME first message id", async () => {
  const { ensureDurable, calls } = machine(async ({ id }) => ({ protocol: 1, session: record(id) }))
  const item = { resource: resource("codex-cli", A, true), label: "untitled" }
  const [x, y] = await Promise.all([ensureDurable(item, "first prompt"), ensureDurable(item, "first prompt")])
  assert.equal(x.id, A)
  assert.equal(x.firstMessageId, y.firstMessageId)
  assert.equal(calls.create.length, 1)
  assert.equal(calls.create[0].firstMessage, "first prompt") // rides along for the label only
  assert.equal(calls.commits.length, 1)
  assert.equal(calls.commits[0].original, item)
  assert.equal(calls.commits[0].modified.metadata.id, A) // the mapped durable item
  assert.equal(calls.itemFires, 1)
  // A retry after create-succeeded-but-dispatch-failed reuses the settled result verbatim.
  assert.deepEqual(await ensureDurable(item, "first prompt"), x)
  assert.equal(calls.create.length, 1)
})

test("a mismatched server ack commits NOTHING and stays retryable", async () => {
  const { ensureDurable, calls } = machine(async () => ({ protocol: 1, session: record("99999999-8888-4777-8666-555544443333") }))
  const item = { resource: resource("codex-cli", A, true) }
  await assert.rejects(ensureDurable(item, "hi"), /mismatched/)
  assert.equal(calls.commits.length, 0)
  await assert.rejects(ensureDurable(item, "hi"))
  assert.equal(calls.create.length, 2) // slot cleared — the untitled editor can try again
})

test("a failed create rejects, fires nothing, and the next send re-attempts", async () => {
  let attempts = 0
  const { ensureDurable, calls } = machine(async ({ id }) =>
    ++attempts === 1 ? Promise.reject(new Error("409")) : { protocol: 1, session: record(id) })
  const item = { resource: resource("codex-cli", A, true) }
  await assert.rejects(ensureDurable(item, "hi"))
  assert.equal(calls.commits.length, 0)
  const ref = await ensureDurable(item, "hi")
  assert.equal(ref.id, A)
  assert.equal(calls.commits.length, 1)
})

test("a foreign resource is refused before any server call", async () => {
  const { ensureDurable, calls } = machine(async () => { throw new Error("must not run") })
  await assert.rejects(ensureDurable({ resource: resource("gemini-cli", A, true) }, "hi"), /codex-cli/)
  await assert.rejects(ensureDurable({ resource: null }, "hi"))
  assert.equal(calls.create.length, 0)
})
