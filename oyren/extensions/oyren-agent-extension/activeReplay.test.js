// Active-response replay: seed the accumulated markdown, tail strictly after the cursor, admit each
// (boot, session, n) once, end on the session's own result — and survive junk/disconnects quietly.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { makeActiveReplay } = require("./activeReplay")
const { createSessionState } = require("./sessionState")
const { collector, fakeToken } = require("./fakes")

const A = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"
const delta = (text) => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } })

function replayWith(frames, state = createSessionState()) {
  const seen = { after: null }
  const sessionClient = {
    streamResponse: (_id, after, onLine) => {
      seen.after = after
      frames.forEach((f) => onLine(f))
      return { done: new Promise(() => {}), cancel() {} } // resolution must come from the result line
    },
  }
  return { seen, state, run: (active) => {
    const { out, stream } = collector()
    return makeActiveReplay({ sessionClient, state, id: A, active })(stream, fakeToken()).then(() => out)
  } }
}

test("seeds the server's partial markdown, tails after the cursor, ends on result", async () => {
  const { seen, run } = replayWith([
    { type: "hello", boot: "boot1", last: 44 },
    { n: 43, line: delta(" milk") }, // first line after the cursor — the seed stops at 42
    { n: 44, line: delta(" and eggs") },
    { n: 44, line: delta(" and eggs") }, // duplicate frame: admitted once
    { n: 45, line: "not json {" }, // junk must not kill the replay
    { n: 46, line: JSON.stringify({ type: "result", is_error: false }) },
  ])
  const out = await run({ id: "x", markdown: "Buying", cursor: 42 })
  assert.equal(seen.after, 42) // strictly-after resume rides the wire, not client filtering
  assert.equal(out.text.join(""), "Buying milk and eggs")
})

test("frames below an earlier session cursor are not re-rendered on reopen", async () => {
  const state = createSessionState()
  state.admitLine(A, "boot1", 44) // an earlier open of this editor already rendered up to 44
  const { run } = replayWith([
    { type: "hello", boot: "boot1", last: 45 },
    { n: 44, line: delta("dup") },
    { n: 45, line: delta("fresh") },
    { n: 46, line: JSON.stringify({ type: "result" }) },
  ], state)
  const out = await run({ id: "x", markdown: "", cursor: 40 })
  assert.equal(out.text.join(""), "fresh")
})

test("a server reboot (new boot id) legitimately resets the cursor", async () => {
  const state = createSessionState()
  state.admitLine(A, "boot1", 99)
  const { run } = replayWith([
    { type: "hello", boot: "boot2", last: 2 },
    { n: 1, line: delta("after reboot") },
    { n: 2, line: JSON.stringify({ type: "result" }) },
  ], state)
  assert.equal((await run({ id: "x", markdown: "", cursor: 0 })).text.join(""), "after reboot")
})

test("cancellation resolves quietly and keeps what already rendered", async () => {
  const token = fakeToken()
  const { out, stream } = collector()
  const p = makeActiveReplay({
    sessionClient: { streamResponse: () => ({ done: new Promise(() => {}), cancel() {} }) },
    state: createSessionState(), id: A, active: { markdown: "kept", cursor: 0 },
  })(stream, token)
  token.fire()
  await p
  assert.equal(out.text.join(""), "kept")
})
