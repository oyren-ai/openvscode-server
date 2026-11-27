// The Oyren Agent chat is retired by default (owner, 2026-11-27): Codespaces use the Claude Code and
// Codex panels instead. Every contribution the Chat view could show must sit behind one setting that
// defaults to off, and activation must register nothing unless that setting is on.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const manifest = require("./package.json")
const { SETTING_SECTION, SETTING_KEY, WHEN, agentChatEnabled } = require("./agentChatGate")

const config = (values) => ({ get: (key, fallback) => (key in values ? values[key] : fallback) })

test("the setting exists, is a boolean and defaults to off", () => {
  const setting = manifest.contributes.configuration.properties[`${SETTING_SECTION}.${SETTING_KEY}`]
  assert.equal(setting.type, "boolean")
  assert.equal(setting.default, false)
})

test("the when clause names that same setting", () => {
  assert.equal(WHEN, `config.${SETTING_SECTION}.${SETTING_KEY}`)
})

test("every participant, chat session type and model vendor waits for the setting", () => {
  const gated = [
    ...manifest.contributes.chatParticipants,
    ...manifest.contributes.chatSessions,
    ...manifest.contributes.languageModelChatProviders,
  ]
  assert.ok(gated.length >= 8)
  for (const entry of gated) assert.equal(entry.when, WHEN, JSON.stringify(entry))
})

test("only an explicit true turns the chat on", () => {
  assert.equal(agentChatEnabled(config({})), false)
  assert.equal(agentChatEnabled(config({ [SETTING_KEY]: false })), false)
  assert.equal(agentChatEnabled(config({ [SETTING_KEY]: "true" })), false)
  assert.equal(agentChatEnabled(config({ [SETTING_KEY]: true })), true)
})
