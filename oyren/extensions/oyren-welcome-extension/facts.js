// The "This Codespace" card. Every fact comes from the machine itself (CPU count, memory, the open
// folder, which agent binaries exist) or from two non-secret launch names: the repository
// (REPO_FULL_NAME, or REPO_FULL_NAMES for a multi-repo launch) and the launch agent's kind
// (AGENT_KIND, shown only through agents.js's fixed name table). No other environment value is read,
// so a token or a user-defined env var can never reach the page.
//
// Time left is deliberately not a number: the session deadline lives in the orchestrator and the
// machine never learns it, so the page points at the header countdown instead of guessing.
const { agentName } = require("./agents")

const GIB = 2 ** 30
// GitHub's owner/repo shape, nothing else: a name that fails it is dropped, not escaped and shown.
const REPO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
const TIME_LEFT = "On the countdown in the Codespace header. +1h adds an hour."

/** The launch's repositories: every valid name of a multi-repo launch, else the single one. */
function repoNames(env) {
  const multi = String(env.REPO_FULL_NAMES || "").split(",").map((name) => name.trim()).filter(Boolean)
  const names = multi.length > 1 ? multi : [String(env.REPO_FULL_NAME || "").trim()]
  return names.filter((name) => REPO_NAME.test(name))
}

function machine(cpus, totalmem) {
  const gb = Math.max(1, Math.round(totalmem / GIB))
  return `${cpus} vCPU · ${gb} GB RAM`
}

/** [{ label, value }] in display order; a fact the machine cannot vouch for is left out. */
function codespaceFacts({ env, cpus, totalmem, folder, installed }) {
  const facts = []
  const repos = repoNames(env)
  if (repos.length === 1) facts.push({ label: "Repository", value: repos[0] })
  if (repos.length > 1) facts.push({ label: "Repositories", value: repos.join(", ") })
  if (folder) facts.push({ label: "Folder", value: folder })
  facts.push({ label: "Machine", value: machine(cpus, totalmem) })
  const launch = agentName(env.AGENT_KIND)
  if (launch) facts.push({ label: "Launched with", value: launch })
  if (installed.length) facts.push({ label: "Agent CLIs", value: installed.join(" · ") })
  facts.push({ label: "Time left", value: TIME_LEFT })
  return facts
}

module.exports = { codespaceFacts, repoNames }
