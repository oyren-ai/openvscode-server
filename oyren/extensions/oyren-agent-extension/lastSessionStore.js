// Pure storage half of "reattach to the same session" (reattach.js is the vscode glue). The record
// lives under context.globalStorageUri — SERVER-side on the droplet — because globalState/
// workspaceState are browser IndexedDB even for remote extensions: they'd work on the machine that
// wrote them and silently miss on every other browser/device.
const fs = require("fs")
const path = require("path")

const FILE = "last-session.json"

/** Untitled sessions don't survive a reboot — recording one would reopen an empty tab. */
function isDurableResource(resourceStr) {
  return typeof resourceStr === "string" && resourceStr.length > 0 && !resourceStr.includes("/untitled")
}

/** Best-effort: recording must never break the session open that triggered it. */
function recordLastSession(storageDir, resourceStr) {
  if (!isDurableResource(resourceStr)) return false
  try {
    fs.mkdirSync(storageDir, { recursive: true })
    fs.writeFileSync(path.join(storageDir, FILE), JSON.stringify({ resource: resourceStr, ts: Date.now() }))
    return true
  } catch {
    return false
  }
}

/** The most-recently-touched durable session's resource string, or null. */
function readLastSession(storageDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(storageDir, FILE), "utf8"))
    return isDurableResource(parsed.resource) ? parsed.resource : null
  } catch {
    return null
  }
}

/** Whether the Claude Code CLI has any session on this machine (its state dir, not ours). */
function claudeHasSessions(homeDir) {
  try {
    const root = path.join(homeDir, ".claude", "projects")
    return fs.readdirSync(root).some((dir) => {
      try {
        return fs.readdirSync(path.join(root, dir)).some((f) => f.endsWith(".jsonl"))
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

module.exports = { recordLastSession, readLastSession, claudeHasSessions, isDurableResource }
