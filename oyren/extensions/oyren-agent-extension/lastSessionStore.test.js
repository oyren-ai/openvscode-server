const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { recordLastSession, readLastSession, claudeHasSessions, isDurableResource } = require("./lastSessionStore")

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oyren-last-session-"))
}

test("round-trips a durable session resource", () => {
  const dir = path.join(tmpDir(), "nested") // also proves the dir is created on demand
  assert.strictEqual(recordLastSession(dir, "codex-cli:/0f7f2a1e-1111-2222-3333-444455556666"), true)
  assert.strictEqual(readLastSession(dir), "codex-cli:/0f7f2a1e-1111-2222-3333-444455556666")
})

test("never records an untitled session (it would reopen as an empty tab)", () => {
  const dir = tmpDir()
  assert.strictEqual(recordLastSession(dir, "codex-cli:/untitled-abc"), false)
  assert.strictEqual(readLastSession(dir), null)
  assert.strictEqual(isDurableResource(""), false)
})

test("a newer touch overwrites the older one", () => {
  const dir = tmpDir()
  recordLastSession(dir, "codex-cli:/aaaaaaaa-1111-2222-3333-444455556666")
  recordLastSession(dir, "opencode:/bbbbbbbb-1111-2222-3333-444455556666")
  assert.strictEqual(readLastSession(dir), "opencode:/bbbbbbbb-1111-2222-3333-444455556666")
})

test("readLastSession tolerates a missing or corrupt store", () => {
  const dir = tmpDir()
  assert.strictEqual(readLastSession(dir), null)
  fs.writeFileSync(path.join(dir, "last-session.json"), "not json")
  assert.strictEqual(readLastSession(dir), null)
})

test("claudeHasSessions sees jsonl session files and nothing else", () => {
  const home = tmpDir()
  assert.strictEqual(claudeHasSessions(home), false)
  const project = path.join(home, ".claude", "projects", "-workspace")
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, "notes.txt"), "")
  assert.strictEqual(claudeHasSessions(home), false)
  fs.writeFileSync(path.join(project, "abc.jsonl"), "")
  assert.strictEqual(claudeHasSessions(home), true)
})
