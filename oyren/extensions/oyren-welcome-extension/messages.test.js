// What a message from the page can do: open one of the listed apps by id, or flip the startup
// setting. Anything else, including a command name, does nothing.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { handleMessage } = require("./messages")

function fake() {
  const calls = []
  const api = { executeCommand: async (command, ...args) => void calls.push([command, ...args]) }
  const saved = []
  return { calls, saved, run: (message) => handleMessage(api, message, async (value) => void saved.push(value)) }
}

test("an app id runs that app's own steps", async () => {
  const { calls, run } = fake()
  await run({ type: "open", id: "terminal" })
  await run({ type: "open", id: "agent" })
  assert.deepEqual(calls, [["workbench.action.terminal.new"], ["workbench.action.terminal.newWithProfile", { profileName: "Agent" }]])
})

test("a command name, an unknown id or a malformed message runs nothing", async () => {
  const { calls, saved, run } = fake()
  for (const message of [
    { type: "open", id: "workbench.action.terminal.sendSequence" }, { type: "open", id: "__proto__" },
    { type: "open", id: 7 }, { type: "run", command: "workbench.action.terminal.new" }, null, "open", [],
    { type: "showOnStartup", value: "false" },
  ]) await run(message)
  assert.deepEqual(calls, [])
  assert.deepEqual(saved, [])
})

test("the checkbox saves a boolean", async () => {
  const { saved, run } = fake()
  await run({ type: "showOnStartup", value: false })
  assert.deepEqual(saved, [false])
})
