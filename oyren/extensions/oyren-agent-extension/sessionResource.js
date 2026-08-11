// Chat-session resource URIs, the client half of the protocol boundary (docs/plans/
// vscode-agent-session-history-client.md "Resource and protocol adapter"). The contributed session
// type is the scheme and the public logical UUID is the only path segment:
//
//   codex-cli:/6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea            durable (server-owned)
//   codex-cli:/untitled-6bf52dd0-...                           untitled (VS Code, pre-create)
//
// Everything else is rejected HERE, before any HTTP: the URI is attacker-adjacent input (restored
// editors, workspace state), and the server must never see a path it didn't mint. The native ACP
// resume id, token, prompt, and workspace path stay out of URIs by construction — nothing here can
// carry them.
//
// Pure module: no vscode require, so tests run under plain `node --test`.

// The six delegated agents (= the runtime's AGENT_KIND ids, verbatim — each rides back as
// ?agent=<type>). claude-code is deliberately absent: launch-only, no ACP side-engine recipe.
const KINDS = [
  { type: "codex-cli", name: "codex" },
  { type: "cursor-cli", name: "cursor" },
  { type: "gemini-cli", name: "gemini" },
  { type: "opencode", name: "opencode" },
  { type: "qwen-code", name: "qwen" },
  { type: "antigravity-cli", name: "antigravity" },
]
const SCHEMES = new Set(KINDS.map((k) => k.type))

// Canonical lowercase only. Uppercase, non-v4 junk, and every percent trick fail this one gate.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UNTITLED = "untitled-" // core mints `${type}:/untitled-${generateUuid()}` (chatNewActions.ts)

const isCanonicalUuid = (s) => typeof s === "string" && UUID.test(s)

/**
 * Parse a chat-session resource into { kind, id, untitled } or null. `kind`, when given, must match
 * the scheme — a codex provider handed a gemini URI is a wiring bug, not a session. The returned
 * `id` is ALWAYS the durable UUID: for an untitled resource it is derived from the untitled UUID,
 * which is what makes create retries idempotent (same untitled tab ⇒ same requested durable id).
 */
function parseSessionResource(resource, kind = null) {
  if (!resource || typeof resource.scheme !== "string") return null
  if (kind ? resource.scheme !== kind : !SCHEMES.has(resource.scheme)) return null
  // A minted URI has nothing but scheme+path; authority/query/fragment means someone else built it.
  if (resource.authority || resource.query || resource.fragment) return null
  const path = typeof resource.path === "string" ? resource.path : ""
  if (!path.startsWith("/")) return null
  const seg = path.slice(1)
  // One segment, no separators (raw or percent-encoded), no traversal — before the UUID gate so a
  // failure here can never be misread as "unknown session" by a caller.
  if (seg.includes("/") || seg.includes("\\") || seg.includes("%") || seg.includes("..")) return null
  if (isCanonicalUuid(seg)) return { kind: resource.scheme, id: seg, untitled: false }
  if (seg.startsWith(UNTITLED) && isCanonicalUuid(seg.slice(UNTITLED.length)))
    return { kind: resource.scheme, id: seg.slice(UNTITLED.length), untitled: true }
  return null
}

/** Path of the durable resource for a session id — `vscode.Uri.from({ scheme: kind, path: durablePath(id) })`. */
function durablePath(id) {
  if (!isCanonicalUuid(id)) throw new Error("not a canonical session id")
  return `/${id}`
}

module.exports = { KINDS, SCHEMES, parseSessionResource, durablePath, isCanonicalUuid }
