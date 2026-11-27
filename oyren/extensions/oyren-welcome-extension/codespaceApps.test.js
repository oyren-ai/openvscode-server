// The welcome page's Codespace apps mirror the hosted registry. The first tests pin the mirror, so
// any change to it is a reviewed diff. The last one diffs it against the hosted source files
// themselves when OYREN_CODESPACE_REPO names an oyren-ai-codespace checkout:
//   OYREN_CODESPACE_REPO=~/oyren-ai/oyren-ai-codespace node --test
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { CODESPACE_APPS, HOSTED_SOURCES } = require("./codespaceApps")
const marks = require("./brandMarks")

const DOCK = ["zed", "vscode", "terminal", "chat", "deepseek", "browser", "docs"]
const OPENED_BY_COMMAND = ["slides", "sheets", "files"]
const LABELS = {
  zed: "Zed", vscode: "VS Code", terminal: "Terminal", chat: "My Codespace", deepseek: "DeepSeek",
  browser: "Browser", docs: "Docs", slides: "Slides", sheets: "Sheets", files: "Files",
}

test("the dock apps, then the windows a command opens, in the hosted order", () => {
  assert.deepEqual(CODESPACE_APPS.filter((app) => app.opened === "dock").map((app) => app.id), DOCK)
  assert.deepEqual(CODESPACE_APPS.filter((app) => app.opened === "command").map((app) => app.id), OPENED_BY_COMMAND)
  assert.equal(CODESPACE_APPS.length, DOCK.length + OPENED_BY_COMMAND.length)
})

test("one name per app, the hosted one", () => {
  for (const app of CODESPACE_APPS) assert.equal(app.label, LABELS[app.id], app.id)
})

test("every app has its tile and a short line saying what it is", () => {
  for (const app of CODESPACE_APPS) {
    assert.match(app.tile, /^<svg class="tile"[^>]*>.*<\/svg>$/s, app.id)
    assert.ok(app.blurb.length > 20 && app.blurb.length <= 140, `${app.id}: ${app.blurb.length}`)
  }
})

const hosted = process.env.OYREN_CODESPACE_REPO
test("the mirror still matches the hosted source files", { skip: hosted ? false : "set OYREN_CODESPACE_REPO" }, () => {
  const read = (key) => fs.readFileSync(path.join(hosted, HOSTED_SOURCES[key]), "utf8")
  const list = (src, name) => JSON.parse(src.match(new RegExp(`export const ${name}\\b[^=]*=\\s*(\\[[^\\]]*\\])`))[1])
  const views = read("views")
  assert.deepEqual(list(views, "WORKBENCH_VIEWS"), DOCK)
  assert.deepEqual(list(views, "STREAM_WINDOW_VIEWS"), OPENED_BY_COMMAND)
  const labelBlock = read("labels").match(/WORKBENCH_LABELS[^{]*\{([^}]*)\}/)[1]
  const labels = Object.fromEntries([...labelBlock.matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]))
  for (const app of CODESPACE_APPS) assert.equal(labels[app.id], app.label, app.id)
  const brand = read("brandPaths")
  for (const name of ["ZED_MARK", "DEEPSEEK_MARK", "VSCODE_MARK"]) {
    assert.equal(brand.match(new RegExp(`export const ${name} =\\s*"([^"]+)"`))[1], marks[name], name)
  }
})
