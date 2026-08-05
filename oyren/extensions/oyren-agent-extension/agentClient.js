// HTTP edge of the extension: the sandbox runtime on 127.0.0.1:${PORT} (sandbox-runtime/src/
// agentChat.js + agentControl.js). Every endpoint carries ?token=<SESSION_TOKEN>, mirroring the
// runtime's own gate; no token in the env means no session — the participant then explains itself
// instead of dialing a server that isn't there (self-hosted editors run outside any session).
const http = require("node:http")

// `kind` selects a SIDE engine (sideEngines.js in the runtime): every request carries ?agent=<kind>
// and streams from that agent instead of the launch one. Omitted ⇒ the launch agent. A client is
// one engine's view — per-engine busy/model state comes free from making one client per kind.
function createClient(env = process.env, kind = null) {
  const port = Number(env.PORT || 8080) // the runtime's single routed port
  const token = env.SESSION_TOKEN || ""
  // `busy` is the one-turn latch for THIS engine (each engine is one persistent agent session);
  // currentModel/modelsLive back ensureModel's "only switch on a KNOWN difference" rule below.
  const state = { busy: false, currentModel: null, modelsLive: false }

  const agentParam = kind ? `&agent=${encodeURIComponent(kind)}` : ""
  const url = (path, extra = "") => `http://127.0.0.1:${port}${path}?token=${encodeURIComponent(token)}${agentParam}${extra}`

  function requestJson(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(url(path), { method, headers: { "content-type": "application/json" } }, (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("error", reject)
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`${path} responded ${res.statusCode}`))
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch (e) { reject(e) }
        })
      })
      req.on("error", reject)
      req.end(body === undefined ? undefined : JSON.stringify(body))
    })
  }

  /** GET /agent/models → [{ value, displayName }]; also learns the session's current model. */
  async function listModels() {
    const out = await requestJson("GET", "/agent/models")
    state.modelsLive = true
    state.currentModel = out.current || null
    return Array.isArray(out.models) ? out.models : []
  }

  /** POST /agent/model — body per agentControl.js: { model: <id> }. */
  async function setModel(id) {
    await requestJson("POST", "/agent/model", { model: id })
    state.currentModel = id
  }

  // Switch only on a KNOWN difference. When /agent/models has never answered, the picker can only be
  // showing the offline fallback entry — posting that fake id would drive the engine blind.
  async function ensureModel(id) {
    if (!id) return
    if (!state.modelsLive) { try { await listModels() } catch { return } }
    if (state.currentModel === id) return
    try { await setModel(id) } catch { /* best-effort: the turn still runs on the session's model */ }
  }

  const interrupt = () => requestJson("POST", "/agent/interrupt")

  /**
   * POST /agent/message?follow=1 — one turn, its ndjson streamed back inline until the `result` line,
   * after which the server closes (agentChat.js follow()). The body is the stream-json user shape
   * extractMessage() prefers; a raw string body would ALSO work, but one that happens to parse as
   * JSON (a pasted `{...}`) would be misread as the structured shape and rejected.
   * ndjson lines split across TCP chunks, so buffer the partial tail; onLine gets parsed objects only.
   */
  function streamTurn(text, onLine) {
    let cancel = () => {}
    const done = new Promise((resolve, reject) => {
      const opts = { method: "POST", headers: { "content-type": "application/json" } }
      const req = http.request(url("/agent/message", "&follow=1"), opts, (res) => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`/agent/message responded ${res.statusCode}`)) }
        let tail = ""
        const emit = (line) => {
          if (!line.trim()) return
          try { onLine(JSON.parse(line)) } catch { /* half a line or junk must never kill the turn */ }
        }
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          const lines = (tail + chunk).split("\n")
          tail = lines.pop()
          lines.forEach(emit)
        })
        res.on("end", () => { emit(tail); resolve() })
        res.on("error", reject)
      })
      req.on("error", reject)
      // Cancel = stop READING; /agent/interrupt is what stops the agent. Resolve rather than reject
      // so the caller ends its turn quietly instead of reporting an unreachable agent.
      cancel = () => { resolve(); try { req.destroy() } catch { /* already gone */ } }
      req.end(JSON.stringify({ message: { content: [{ type: "text", text }] } }))
    })
    return { done, cancel: () => cancel() }
  }

  return { port, token, state, listModels, setModel, ensureModel, interrupt, streamTurn }
}

module.exports = { createClient }
