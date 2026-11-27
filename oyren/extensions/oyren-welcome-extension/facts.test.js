// What the welcome page says about this Codespace: only facts read from the machine or from the two
// non-secret launch names (the repo and the launch agent's kind), never another env value.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { CLI_AGENTS, agentName, installedAgents } = require("./agents")
const { codespaceFacts, repoNames } = require("./facts")

const GIB = 2 ** 30
const base = { env: {}, cpus: 4, totalmem: 7.8 * GIB, folder: "/home/oyren/workspace/riemann-hypothesis", installed: [] }
const value = (facts, label) => facts.find((fact) => fact.label === label)?.value

test("the agent table mirrors the hosted catalogue's names and binaries", () => {
  // oyren-ai-codespace hosted/packages/core/src/lib/agent/cliInventory.ts (CLI_KIND_LABELS) and
  // hosted/packages/core/src/constants/cliBinaries.ts (CLI_BINARIES).
  assert.deepEqual(CLI_AGENTS.map(({ kind, name, binary }) => [kind, name, binary]), [
    ["claude-code", "Claude Code", "claude"], ["codex-cli", "Codex", "codex"],
    ["gemini-cli", "Gemini CLI", "gemini"], ["qwen-code", "Qwen Code", "qwen"],
    ["opencode", "OpenCode", "opencode"], ["cursor-cli", "Cursor", "agent"],
    ["antigravity-cli", "Antigravity", "agy"],
  ])
  assert.equal(agentName("codex-cli"), "Codex")
  assert.equal(agentName("rm -rf /"), null)
})

test("installed agents are the ones whose binary is executable on PATH", () => {
  const onDisk = new Set(["/usr/local/bin/claude", "/home/oyren/.local/share/pnpm/codex"])
  const found = installedAgents("/usr/local/bin:relative/dir:/home/oyren/.local/share/pnpm", (file) => onDisk.has(file))
  assert.deepEqual(found, ["Claude Code", "Codex"])
  assert.deepEqual(installedAgents(undefined, () => true), [])
})

test("a Codespace's facts: repository, folder, machine, launch agent, CLIs, time left", () => {
  const env = { REPO_FULL_NAME: "leanprover-community/riemann-hypothesis", AGENT_KIND: "claude-code" }
  const facts = codespaceFacts({ ...base, env, installed: ["Claude Code", "Codex"] })
  assert.deepEqual(facts.map((fact) => fact.label), ["Repository", "Folder", "Machine", "Launched with", "Agent CLIs", "Time left"])
  assert.equal(value(facts, "Repository"), "leanprover-community/riemann-hypothesis")
  assert.equal(value(facts, "Machine"), "4 vCPU · 8 GB RAM")
  assert.equal(value(facts, "Launched with"), "Claude Code")
  assert.equal(value(facts, "Agent CLIs"), "Claude Code · Codex")
  assert.match(value(facts, "Time left"), /countdown in the Codespace header/)
})

test("a multi-repo launch lists every repository, and junk names are dropped", () => {
  assert.deepEqual(repoNames({ REPO_FULL_NAMES: "a/one,b/two", REPO_FULL_NAME: "a/one" }), ["a/one", "b/two"])
  assert.deepEqual(repoNames({ REPO_FULL_NAME: "<script>alert(1)</script>" }), [])
  assert.deepEqual(repoNames({ REPO_FULL_NAME: "owner/repo/extra" }), [])
  const facts = codespaceFacts({ ...base, env: { REPO_FULL_NAMES: "a/one,b/two" } })
  assert.equal(value(facts, "Repositories"), "a/one, b/two")
})

test("absent or unknown launch facts are left out rather than guessed", () => {
  const facts = codespaceFacts({ ...base, env: { AGENT_KIND: "something-new" }, folder: null, cpus: 1, totalmem: 0.96 * GIB })
  assert.deepEqual(facts.map((fact) => fact.label), ["Machine", "Time left"])
  assert.equal(value(facts, "Machine"), "1 vCPU · 1 GB RAM")
})

test("no other environment value ever reaches the page", () => {
  const env = {
    REPO_FULL_NAME: "acme/app", AGENT_KIND: "codex-cli", SESSION_TOKEN: "tok-secret-1234",
    CONTROL_TOKEN: "ctl-secret-5678", GITHUB_TOKEN: "ghp_secret", OYREN_SESSION_UUID: "uuid-9999",
  }
  const text = JSON.stringify(codespaceFacts({ ...base, env }))
  for (const secret of ["tok-secret-1234", "ctl-secret-5678", "ghp_secret", "uuid-9999"]) assert.ok(!text.includes(secret))
})
