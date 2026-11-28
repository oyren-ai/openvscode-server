// The in-editor tools the page can open: shown only when this machine has them, and opened only
// through a fixed list of commands, never one named by the page.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { EDITOR_APPS, SIDE_BAR_DEFAULTS, presentEditorApps, runsFor } = require("./editorApps")

const has = (...ids) => (id) => ids.includes(id)

test("Claude Code and Codex lead, then the other agents, the terminals and Preview", () => {
  assert.deepEqual(EDITOR_APPS.map((app) => app.id), ["claude", "codex", "qwen", "lean", "agent", "terminal", "preview"])
})

test("an app backed by an extension shows only when that extension is installed", () => {
  const all = presentEditorApps(has("anthropic.claude-code", "openai.chatgpt", "qwenlm.qwen-code-vscode-ide-companion",
    "leanprover.lean4", "oyren.oyren-preview")).map((app) => app.id)
  assert.deepEqual(all, ["claude", "codex", "qwen", "lean", "agent", "terminal", "preview"])
  assert.deepEqual(presentEditorApps(has()).map((app) => app.id), ["agent", "terminal"])
  assert.deepEqual(presentEditorApps(has("openai.chatgpt")).map((app) => app.id), ["codex", "agent", "terminal"])
})

test("every app opens through fixed commands, its own extension's first", () => {
  for (const app of EDITOR_APPS) {
    assert.ok(app.run.length > 0, app.id)
    for (const step of app.run) assert.equal(typeof step.command, "string")
    assert.ok(app.extension || app.tile, `${app.id} needs an extension icon or a tile`)
  }
  assert.deepEqual(runsFor("claude").map((step) => step.command),
    ["workbench.view.extension.claude-sidebar-secondary", "claude-vscode.sidebar.open"])
  assert.deepEqual(runsFor("agent"), [{ command: "workbench.action.terminal.newWithProfile", args: [{ profileName: "Agent" }] }])
})

test("an id the page made up opens nothing", () => {
  for (const id of ["workbench.action.terminal.sendSequence", "__proto__", "constructor", "", undefined]) assert.deepEqual(runsFor(id), [])
})

test("the side bar defaults to Claude Code, then Codex", () => {
  assert.deepEqual(SIDE_BAR_DEFAULTS, ["claude", "codex"])
})
