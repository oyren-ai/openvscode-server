// The editor's start: the built-in Chat view hidden unless the Oyren Agent chat is on, Claude Code
// (else Codex) opened in the side bar on a workspace's first start, then the welcome page when the
// editor area is empty.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { runStartup, apiFrom, SIDE_BAR_LATCH, AGENT_CHAT_SETTING } = require("./startup")

const userTab = { label: "README.md", input: { uri: "file:///home/oyren/workspace/README.md" } }
const stockWalkthrough = { label: "Walkthrough: Setup VS Code Web", input: undefined }

function fakeApi({ agentChat = false, extensions = [], failing = [], latched = false, tabs = [], showOnStartup = true } = {}) {
  const calls = []
  const state = new Map(latched ? [[SIDE_BAR_LATCH, true]] : [])
  const api = {
    executeCommand: async (command, ...args) => {
      calls.push([command, ...args])
      if (failing.includes(command)) throw new Error(`command '${command}' not found`)
    },
    hasExtension: (id) => extensions.includes(id),
    agentChatEnabled: () => agentChat,
    showOnStartup: () => showOnStartup,
    tabGroups: { all: [{ tabs }] },
    closeTabs: async (closed) => void calls.push(["close", ...closed.map((tab) => tab.label)]),
    workspaceState: { get: (key) => state.get(key), update: async (key, value) => void state.set(key, value) },
  }
  return { api, calls, state }
}
const start = async (options) => {
  const fake = fakeApi(options)
  await runStartup(fake.api, async () => void fake.calls.push(["open welcome"]))
  return fake
}
const CLAUDE = "anthropic.claude-code"
const CODEX = "openai.chatgpt"

test("the built-in Chat view is hidden first, then Claude Code opens, then the welcome page", async () => {
  const { calls, state } = await start({ extensions: [CLAUDE, CODEX] })
  assert.deepEqual(calls, [
    ["setContext", "chatSetupHidden", true],
    ["workbench.view.extension.claude-sidebar-secondary"],
    ["open welcome"],
  ])
  assert.equal(state.get(SIDE_BAR_LATCH), true)
})

test("the side bar default happens once per workspace, so a later choice of Codex sticks", async () => {
  const { calls } = await start({ extensions: [CLAUDE, CODEX], latched: true })
  assert.deepEqual(calls, [["setContext", "chatSetupHidden", true], ["open welcome"]])
})

test("a renamed view command falls through to Claude Code's own command", async () => {
  const { calls } = await start({ extensions: [CLAUDE], failing: ["workbench.view.extension.claude-sidebar-secondary"] })
  assert.deepEqual(calls.slice(1, 3), [["workbench.view.extension.claude-sidebar-secondary"], ["claude-vscode.sidebar.open"]])
})

test("without Claude Code the side bar opens Codex", async () => {
  const { calls, state } = await start({ extensions: [CODEX] })
  assert.deepEqual(calls[1], ["workbench.view.extension.codexSecondaryViewContainer"])
  assert.equal(state.get(SIDE_BAR_LATCH), true)
})

test("with neither installed nothing is opened in the side bar and nothing is latched", async () => {
  const { calls, state } = await start({ extensions: [], failing: [] })
  assert.deepEqual(calls, [["setContext", "chatSetupHidden", true], ["open welcome"]])
  assert.equal(state.get(SIDE_BAR_LATCH), undefined)
})

test("with every command failing the start still finishes, unlatched", async () => {
  const failing = ["workbench.view.extension.claude-sidebar-secondary", "claude-vscode.sidebar.open",
    "workbench.view.extension.codexSecondaryViewContainer", "chatgpt.openSidebar"]
  const { calls, state } = await start({ extensions: [CLAUDE, CODEX], failing })
  assert.deepEqual(calls.at(-1), ["open welcome"])
  assert.equal(state.get(SIDE_BAR_LATCH), undefined)
})

test("with the Oyren Agent chat switched on, Chat stays and keeps the side bar", async () => {
  const { calls } = await start({ agentChat: true, extensions: [CLAUDE, CODEX] })
  assert.deepEqual(calls, [["setContext", "chatSetupHidden", false], ["open welcome"]])
})

test("the welcome page opens only into an empty editor area, and only while the setting is on", async () => {
  assert.ok(!(await start({ tabs: [userTab] })).calls.some(([command]) => command === "open welcome"))
  assert.ok(!(await start({ showOnStartup: false })).calls.some(([command]) => command === "open welcome"))
})

test("the stock Welcome walkthrough the workbench opened first is replaced by the page", async () => {
  const { calls } = await start({ tabs: [stockWalkthrough] })
  assert.deepEqual(calls.slice(-2), [["close", "Walkthrough: Setup VS Code Web"], ["open welcome"]])
})

test("beside the user's own editors the stock Welcome page is left alone and nothing opens", async () => {
  const { calls } = await start({ tabs: [stockWalkthrough, userTab] })
  assert.ok(!calls.some(([command]) => command === "close" || command === "open welcome"))
})

test("a restored welcome page counts as the user's: no second copy, and nothing is closed", async () => {
  const restored = { label: "Welcome", input: { viewType: "mainThreadWebview-oyren.welcome" } }
  const { calls } = await start({ tabs: [restored] })
  assert.ok(!calls.some(([command]) => command === "close" || command === "open welcome"))
})

// The fakes above hand in agentChatEnabled, so this is the one place that ties the setting the start
// reads to the agent extension's own: renamed there, a chat turned back on would still be hidden here.
test("the start reads the agent extension's switch, under the agent extension's spelling", () => {
  const { SETTING_SECTION, SETTING_KEY } = require("../oyren-agent-extension/agentChatGate")
  const read = []
  const vscode = {
    workspace: {
      getConfiguration: (section) => ({
        get: (key, fallback) => {
          read.push(`${section}.${key}`)
          return fallback
        },
      }),
    },
    window: { tabGroups: { all: [] } },
  }
  assert.equal(apiFrom(vscode, { workspaceState: {} }).agentChatEnabled(), false)
  assert.deepEqual(read, [`${SETTING_SECTION}.${SETTING_KEY}`])
  assert.equal(AGENT_CHAT_SETTING, `${SETTING_SECTION}.${SETTING_KEY}`)
})
