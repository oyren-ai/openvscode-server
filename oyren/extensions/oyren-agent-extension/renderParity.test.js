// Live/restored conformance over the shared stream fixtures: what foldLine renders for a streamed
// turn must equal the markdown the server persists for that turn — the same fixtures lock the
// server-side projector (runtime repo), which is what makes reopened history match what was seen.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { foldLine } = require("./renderStream")
const { collector } = require("./fakes")
const turnFixture = require("./fixtures/streamTurn.json")
const errorFixture = require("./fixtures/streamError.json")
const historyFixture = require("./fixtures/history.json")

const fold = (lines) => {
  const { out, stream } = collector()
  const sink = { text: (t) => stream.markdown(t), progress: (m) => stream.progress(m) }
  let ended = false
  for (const line of lines) {
    assert.equal(ended, false, "no line may follow the result")
    ended = foldLine(line, sink)
  }
  return { ...out, ended }
}

test("a streamed success turn renders exactly the fixture's visible text", () => {
  const { text, progress, ended } = fold(turnFixture.lines)
  assert.equal(text.join(""), turnFixture.visible)
  assert.deepEqual(progress, turnFixture.progress) // tool_use → transient progress, live-only
  assert.equal(ended, true) // `result` ends the turn even if the socket lingers
})

test("consolidated assistant text does not duplicate the streamed deltas", () => {
  const { text } = fold(turnFixture.lines)
  const whole = text.join("")
  assert.equal(whole.match(/a race in the fixture cleanup/g).length, 1)
})

test("thinking, tool results, pings, and unknown line types render nothing", () => {
  const silent = turnFixture.lines.filter((l) => ["user", "ping", "some_future_line_type"].includes(l.type))
  const { text, progress } = fold([...silent, { type: "result", is_error: false }])
  assert.deepEqual(text, [])
  assert.deepEqual(progress, [])
})

test("an error result appends the readable error exactly once", () => {
  const { text, ended } = fold(errorFixture.lines)
  assert.equal(text.join(""), errorFixture.visible)
  assert.equal(text.join("").match(/Boom: disk full/g).length, 1)
  assert.equal(ended, true)
})

test("RESTORED equals LIVE: the history fixture's error markdown is the live projection", () => {
  const restored = historyFixture.interactions[2].response.markdown
  assert.equal(restored, fold(errorFixture.lines).text.join(""))
})

test("junk lines never kill a fold", () => {
  const { ended } = fold([null, 42, "string", { type: "assistant" }, { type: "result" }])
  assert.equal(ended, true)
})
