// The Lean 4 card shows the InfoView and never closes it: lean4.toggleInfoview closes an open one,
// and opens none while the welcome page is the active editor. So a Lean file comes to the front
// first, then lean4.displayGoal runs.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { LEAN_INFOVIEW_COMMAND, showLeanInfoview } = require("./lean")
const { runsFor } = require("./editorApps")

const uri = (path) => ({ path })
const doc = (path, languageId) => ({ uri: uri(path), languageId })

function fakeApi({ editors = [], tabs = [] } = {}) {
  const calls = []
  const api = {
    executeCommand: async (command, ...args) => void calls.push([command, ...args]),
    showTextDocument: async (target, options) => void calls.push(["show", target.uri ? target.uri.path : target.path, options.viewColumn]),
    visibleTextEditors: () => editors,
    tabGroups: { all: [{ tabs }] },
  }
  return { api, calls }
}

test("the card runs this extension's command, never lean4.toggleInfoview", () => {
  assert.deepEqual(runsFor("lean"), [{ command: LEAN_INFOVIEW_COMMAND, args: [] }])
})

test("a Lean file on screen comes to the front, then its goals show in the InfoView", async () => {
  const { api, calls } = fakeApi({
    editors: [
      { document: doc("/home/oyren/workspace/README.md", "markdown"), viewColumn: 1 },
      { document: doc("/home/oyren/workspace/Main.lean", "lean4"), viewColumn: 2 },
    ],
  })
  await showLeanInfoview(api)
  assert.deepEqual(calls, [["show", "/home/oyren/workspace/Main.lean", 2], ["lean4.displayGoal"]])
})

test("a Lean file open in a background tab is brought back in its own group", async () => {
  const group = { viewColumn: 3 }
  const { api, calls } = fakeApi({
    editors: [{ document: doc("/home/oyren/workspace/notes.txt", "plaintext"), viewColumn: 1 }],
    tabs: [{ label: "Welcome", input: undefined, group }, { label: "Basic.lean", input: { uri: uri("/home/oyren/workspace/Basic.lean") }, group }],
  })
  await showLeanInfoview(api)
  assert.deepEqual(calls, [["show", "/home/oyren/workspace/Basic.lean", 3], ["lean4.displayGoal"]])
})

test("with no Lean file open, Quick Open lists the workspace's Lean files and no InfoView command runs", async () => {
  const { api, calls } = fakeApi({ editors: [{ document: doc("/home/oyren/workspace/a.py", "python"), viewColumn: 1 }] })
  await showLeanInfoview(api)
  assert.deepEqual(calls, [["workbench.action.quickOpen", ".lean"]])
})
