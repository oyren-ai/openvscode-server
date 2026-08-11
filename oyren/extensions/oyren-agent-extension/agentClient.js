// The LEGACY per-kind client: the sandbox runtime on 127.0.0.1:${PORT}, one engine's view, exactly
// the surface the default participant and lm provider always had. Every endpoint carries
// ?token=<SESSION_TOKEN>; no token in the env means no session — the participant then explains
// itself instead of dialing a server that isn't there (self-hosted editors run outside sessions).
//
// Session-aware (protocol v1) calls live in sessionClient.js, built on the SAME transport
// (agentHttp.js) — this file stays the parameter-free path a legacy runtime understands, and the
// default `oyren.agent` participant never calls anything else.
const { createTransport } = require("./agentHttp")

// `kind` selects a SIDE engine (sideEngines.js in the runtime): every request carries ?agent=<kind>
// and streams from that agent instead of the launch one. Omitted ⇒ the launch agent. A client is
// one engine's view — per-engine busy/model state comes free from making one client per kind.
function createClient(env = process.env, kind = null) {
  const transport = createTransport(env)
  // `busy` is the one-turn latch for THIS engine (each engine is one persistent agent session);
  // currentModel/modelsLive back ensureModel's "only switch on a KNOWN difference" rule below.
  // Protocol sessions do NOT use this latch — theirs is per-UUID in sessionState.js.
  const state = { busy: false, currentModel: null, modelsLive: false }
  const params = kind ? { agent: kind } : {}

  /** GET /agent/models → [{ value, displayName }]; also learns the session's current model. */
  async function listModels() {
    const out = await transport.requestJson("GET", "/agent/models", { params })
    state.modelsLive = true
    state.currentModel = out.current || null
    return Array.isArray(out.models) ? out.models : []
  }

  /** POST /agent/model — body per agentControl.js: { model: <id> }. */
  async function setModel(id) {
    await transport.requestJson("POST", "/agent/model", { params, body: { model: id } })
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

  const interrupt = () => transport.requestJson("POST", "/agent/interrupt", { params })

  /**
   * POST /agent/message?follow=1 — one turn, its ndjson streamed back inline until the `result`
   * line, after which the server closes (agentChat.js follow()). The body is the stream-json user
   * shape extractMessage() prefers; a raw string body would ALSO work, but one that happens to
   * parse as JSON (a pasted `{...}`) would be misread as the structured shape and rejected.
   * Cancel = stop READING; /agent/interrupt is what stops the agent.
   */
  const streamTurn = (text, onLine) =>
    transport.streamNdjson("POST", "/agent/message", {
      params: { ...params, follow: 1 },
      body: { message: { content: [{ type: "text", text }] } },
      onLine,
    })

  return { port: transport.port, token: transport.token, transport, state, listModels, setModel, ensureModel, interrupt, streamTurn }
}

module.exports = { createClient }
