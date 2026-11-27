// The agent CLIs a Codespace image carries, as the product names them. A mirror of the hosted app's
// catalogue in oyren-ai-codespace (keep in step when a CLI joins or leaves the image):
//   hosted/packages/core/src/lib/agent/cliInventory.ts   CLI_KIND_LABELS (the names)
//   hosted/packages/core/src/constants/cliBinaries.ts    CLI_BINARIES    (the binaries)
// facts.test.js pins this table, so a change here is a visible, reviewed change.
const path = require("path")

const CLI_AGENTS = Object.freeze([
  { kind: "claude-code", name: "Claude Code", binary: "claude" },
  { kind: "codex-cli", name: "Codex", binary: "codex" },
  { kind: "gemini-cli", name: "Gemini CLI", binary: "gemini" },
  { kind: "qwen-code", name: "Qwen Code", binary: "qwen" },
  { kind: "opencode", name: "OpenCode", binary: "opencode" },
  { kind: "cursor-cli", name: "Cursor", binary: "agent" },
  { kind: "antigravity-cli", name: "Antigravity", binary: "agy" },
])

/** The product name of a launch kind (AGENT_KIND), or null for anything this table does not know. */
function agentName(kind) {
  const agent = CLI_AGENTS.find((candidate) => candidate.kind === kind)
  return agent ? agent.name : null
}

/**
 * The names of the agents whose binary is on PATH — read-only, nothing is executed. Only absolute
 * PATH entries count, so a relative entry can never point the check at the working directory.
 */
function installedAgents(pathEnv, isExecutable) {
  const dirs = String(pathEnv || "").split(path.delimiter).filter((dir) => path.isAbsolute(dir))
  return CLI_AGENTS.filter(({ binary }) => dirs.some((dir) => isExecutable(path.join(dir, binary))))
    .map(({ name }) => name)
}

module.exports = { CLI_AGENTS, agentName, installedAgents }
