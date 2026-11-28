// Only the retired chat waits for oyren.agentChat.enabled; nothing else in activate() may. The
// terminal image paste (open PR #16) registers in this same activate(), and an early return for the
// chat would switch it off too, silently. activate() runs here against a fake vscode that records
// every registration, once with the setting on and once with it off.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")

let settings = {}
let calls = []
const disposable = () => ({ dispose() {} })
class EventEmitter {
  constructor() { this.event = () => disposable() }
  fire() {}
  dispose() {}
}
class Stub {} // any other vscode class or enum (ThemeIcon, ChatSessionStatus, …)
// A call into any vscode namespace is recorded as "namespace.method:first argument" and answers a
// disposable. Namespaces this fake does not spell out (commands, window, languages, …) record too, so
// a registration added later is covered without a change here.
const namespace = (name, own = {}) => new Proxy(own, {
  get: (target, key) => {
    if (key in target || typeof key !== "string") return target[key]
    return (first) => {
      calls.push(`${name}.${key}:${typeof first === "string" ? first : typeof first}`)
      return disposable()
    }
  },
})
const fakeVscode = new Proxy({
  EventEmitter,
  workspace: namespace("workspace", {
    getConfiguration: (section) => ({ get: (key, fallback) => (`${section}.${key}` in settings ? settings[`${section}.${key}`] : fallback) }),
  }),
  lm: namespace("lm", {
    selectChatModels: (selector) => {
      calls.push(`lm.selectChatModels:${selector.vendor}`)
      return Promise.resolve([])
    },
  }),
}, {
  get: (target, key) => {
    if (key in target || typeof key !== "string") return target[key]
    return /^[A-Z]/.test(key) ? Stub : namespace(key)
  },
})

const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  return request === "vscode" ? "vscode" : resolve.call(this, request, ...rest)
}
require.cache.vscode = { id: "vscode", filename: "vscode", loaded: true, exports: fakeVscode }
const { activate } = require("./extension")

/** Runs activate() with the setting at `value` (undefined: not set) and returns what it registered. */
function activateWith(value) {
  settings = value === undefined ? {} : { "oyren.agentChat.enabled": value }
  calls = []
  activate({ subscriptions: [] })
  return calls
}
const isChat = (call) => call.startsWith("chat.") || call.startsWith("lm.")

test("with the setting on, the chat registers its participant, model vendor and six session types", () => {
  const registered = activateWith(true)
  assert.ok(registered.includes("chat.createChatParticipant:oyren.agent"), registered.join("\n"))
  assert.ok(registered.includes("lm.registerLanguageModelChatProvider:oyren"))
  assert.equal(registered.filter((call) => call.startsWith("chat.registerChatSessionItemProvider:")).length, 6)
})

test("with the setting off or unset, activate() registers none of the chat", () => {
  for (const value of [undefined, false, "true"]) assert.deepEqual(activateWith(value).filter(isChat), [], String(value))
})

test("with the chat off, everything else activate() registers still registers", () => {
  const others = activateWith(true).filter((call) => !isChat(call))
  assert.deepEqual(activateWith(undefined), others)
  assert.deepEqual(activateWith(false), others)
})

const hasTerminalPaste = fs.existsSync(path.join(__dirname, "terminalPaste.js"))
test("the terminal image paste registers with the chat off", { skip: !hasTerminalPaste && "terminalPaste.js (PR #16) is not on this branch" }, () => {
  const registered = activateWith(undefined)
  assert.ok(registered.includes("commands.registerCommand:oyren.terminal.pasteImage"), registered.join("\n"))
  assert.ok(registered.includes("commands.registerCommand:oyren.terminal.cleanupPasteSession"))
})
