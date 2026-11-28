// The Oyren Agent chat is off unless `oyren.agentChat.enabled` turns it on (owner, 2026-11-27:
// Codespaces use the Claude Code and Codex panels in the secondary side bar instead).
//
// Two halves keep it off: package.json gates every contribution the workbench reads without running
// us (the default participant, the chat session types, the model vendor) on WHEN, and activate()
// registers none of the chat while this returns false (the rest of activate() still runs). Built-in
// Chat is then left with no default
// participant; the welcome extension hides the Chat view itself (oyren-welcome-extension/startup.js).
// Flipping the setting takes effect on the next editor reload. It is machine-scoped, and the boot
// overlay rewrites the machine settings from oyren/settings/machine-settings.json at every editor
// start, so it is turned on for good there (and published), not in one Codespace (oyren/README.md).
const SETTING_SECTION = "oyren"
const SETTING_KEY = "agentChat.enabled"
const WHEN = "config.oyren.agentChat.enabled"

/** True only for an explicit boolean true: an unset, misspelt or string value keeps the chat off. */
function agentChatEnabled(config) {
  return config.get(SETTING_KEY, false) === true
}

module.exports = { SETTING_SECTION, SETTING_KEY, WHEN, agentChatEnabled }
