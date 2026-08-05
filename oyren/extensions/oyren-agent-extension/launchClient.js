// An MCP client exactly big enough to call the orchestrator's `launch_agent` tool — the machinery
// behind the /codex-style slash commands (docs/oyren-chat-launch.md). The session env carries the
// same MCP connections the agent itself uses (OYREN_MCP_SERVERS, [{name,url,token?}]); rather than
// guessing which one hosts the launcher by name, every connection is probed once (initialize →
// tools/list) and the first advertising launch_agent is cached for the session's lifetime.
const NO_MCP = "Launching isn't wired in this environment — no MCP connection in the session env offers launch_agent."

let nextId = 1
let cached = null // { url, token, mcpSessionId } once a launcher connection is found

function connections(env = process.env) {
  try { const v = JSON.parse(env.OYREN_MCP_SERVERS || "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** One JSON-RPC exchange over MCP streamable HTTP. Answers arrive as plain JSON or as an SSE body
 *  (`data:` lines) depending on the server — both are handled; notifications get no id and expect
 *  no reply. Returns { result, mcpSessionId } and throws on JSON-RPC errors. */
async function rpc(conn, mcpSessionId, method, params, isNotification = false) {
  const id = isNotification ? undefined : nextId++
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" }
  if (conn.token) headers.authorization = `Bearer ${conn.token}`
  if (mcpSessionId) headers["mcp-session-id"] = mcpSessionId
  const res = await fetch(conn.url, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined && { id }), method, ...(params && { params }) }),
    signal: AbortSignal.timeout(20_000),
  })
  const sid = res.headers.get("mcp-session-id") || mcpSessionId
  if (isNotification) return { result: undefined, mcpSessionId: sid }
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`)
  const text = await res.text()
  const messages = (res.headers.get("content-type") || "").includes("event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => { try { return JSON.parse(l.slice(5)) } catch { return null } })
    : [(() => { try { return JSON.parse(text) } catch { return null } })()]
  const reply = messages.find((m) => m && m.id === id)
  if (!reply) throw new Error(`${method} → no JSON-RPC reply`)
  if (reply.error) throw new Error(reply.error.message || `${method} failed`)
  return { result: reply.result, mcpSessionId: sid }
}

async function probe(conn) {
  const init = await rpc(conn, null, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "oyren-agent", version: "0.2.0" },
  })
  await rpc(conn, init.mcpSessionId, "notifications/initialized", undefined, true).catch(() => {})
  const tools = await rpc(conn, init.mcpSessionId, "tools/list", {})
  const has = ((tools.result && tools.result.tools) || []).some((t) => t && t.name === "launch_agent")
  return has ? { url: conn.url, token: conn.token, mcpSessionId: tools.mcpSessionId } : null
}

async function findLauncher(env = process.env) {
  if (cached) return cached
  for (const conn of connections(env)) {
    try { const hit = await probe(conn); if (hit) { cached = hit; return cached } } catch { /* next connection */ }
  }
  return null
}

/** Launch a NEW session running `agentKind`, delivering `prompt` as its first task. Resolves to the
 *  tool's own human-readable text (it names the session id) — never throws; failures come back as
 *  text too, because everything returned here renders directly into the chat. */
async function launchAgent(agentKind, prompt, env = process.env) {
  try {
    const launcher = await findLauncher(env)
    if (!launcher) return NO_MCP
    const args = { agentKind, prompt }
    if (env.OYREN_SESSION_UUID) args.fromSession = env.OYREN_SESSION_UUID
    const { result } = await rpc(launcher, launcher.mcpSessionId, "tools/call", { name: "launch_agent", arguments: args })
    const text = ((result && result.content) || []).filter((c) => c && c.type === "text").map((c) => c.text).join("\n")
    return text || "Launched (the orchestrator returned no details)."
  } catch (err) {
    cached = null // a dead connection must not poison every later launch
    return `Launch failed: ${String((err && err.message) || err)}`
  }
}

module.exports = { launchAgent, connections }
