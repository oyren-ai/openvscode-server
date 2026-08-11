// /codex-style slash commands on the DEFAULT participant: each launches a NEW paid session running
// that agent, with the typed text as its first task (docs/oyren-chat-launch.md). Distinct from the
// agent-type dropdown, which runs a SIDE engine on THIS machine — a launch is a fresh sandbox.
const { launchAgent } = require("./launchClient")

const LAUNCH_KINDS = {
  claude: "claude-code", codex: "codex-cli", cursor: "cursor-cli", gemini: "gemini-cli",
  opencode: "opencode", qwen: "qwen-code", antigravity: "antigravity-cli",
}

async function handleLaunch(stream, command, prompt) {
  if (!prompt) return void stream.markdown(`Add the first task after the command — e.g. \`/${command} fix the failing tests\`.`)
  stream.progress(`Launching a new ${command} session…`)
  const text = await launchAgent(LAUNCH_KINDS[command], prompt)
  stream.markdown(text)
  // The tool's reply names the session id; make it a door, not just a fact.
  const id = /session ([0-9a-f-]{8,})/i.exec(text)
  if (id) stream.markdown(`\n\n[Open the session](https://oyren.ai/session/${id[1]})`)
}

module.exports = { LAUNCH_KINDS, handleLaunch }
