// Protocol-v1 edge for ONE agent kind (docs/plans/vscode-agent-session-history-client.md, mirror of
// the runtime plan's "Protocol v1"). Unlike the legacy client, `kind` here is ALWAYS sent verbatim —
// an explicit logical session is a side session even when its kind equals the launch AGENT_KIND, so
// no null-for-launch aliasing exists on this path. Every logical call carries agent+session as a
// pair; the runtime 400s a lone half, and so do we (fail before HTTP, not after).
const { createTransport, HttpError } = require("./agentHttp")
const { isCanonicalUuid } = require("./sessionResource")

const LEGACY = Object.freeze({ protocol: 0, legacy: true })

function createSessionClient(kind, transport = createTransport()) {
  let caps = null // single-flight: every caller of an unsettled fetch shares it

  /** Feature detection. 404 = legacy runtime, cached for the process (the runtime doesn't upgrade
   *  under us). A NETWORK failure answers legacy too but is NOT cached — the next call retries, so
   *  one boot-time hiccup can't lock a capable runtime out of history for the whole process. */
  function getCapabilities(cancelToken) {
    if (caps) return caps
    const p = transport.requestJson("GET", "/agent/capabilities", { token: cancelToken })
      .then((out) => (out && out.protocol >= 1 ? out : LEGACY))
      .catch((err) => {
        if (err instanceof HttpError && err.status === 404) return LEGACY
        if (caps === p) caps = null // transient: forget, retry later
        return LEGACY
      })
    caps = p
    return p
  }

  const sessionParams = (id) => {
    if (!isCanonicalUuid(id)) throw new Error("not a canonical session id") // before any HTTP
    return { agent: kind, session: id }
  }

  const listSessions = (cancelToken) =>
    transport.requestJson("GET", "/agent/sessions", { params: { agent: kind }, token: cancelToken })

  /** Idempotent by id (201 first, 200 on retry — the transport accepts both). The server derives
   *  the label from firstMessage; we never send a prompt anywhere else in this file. */
  const createSession = ({ id, firstMessage, model }, cancelToken) =>
    transport.requestJson("POST", "/agent/sessions", {
      body: { id: sessionParams(id).session, agent: kind, firstMessage, model: model || undefined },
      token: cancelToken,
    })

  const getSession = (id, cancelToken) =>
    transport.requestJson("GET", `/agent/sessions/${sessionParams(id).session}`, { token: cancelToken })

  const getHistory = (id, cancelToken) =>
    transport.requestJson("GET", `/agent/sessions/${sessionParams(id).session}/history`, { token: cancelToken })

  const listModels = (id, cancelToken) =>
    transport.requestJson("GET", "/agent/models", { params: sessionParams(id), token: cancelToken })

  const setModel = (id, model, cancelToken) =>
    transport.requestJson("POST", "/agent/model", { params: sessionParams(id), body: { model }, token: cancelToken })

  const interrupt = (id) =>
    transport.requestJson("POST", "/agent/interrupt", { params: sessionParams(id) })

  /** One turn in one session. `clientMessageId` makes a retried send return the original receipt
   *  instead of invoking the engine twice. Cancel stops READING only — interrupt() stops the agent. */
  const streamTurn = (id, text, clientMessageId, onLine) =>
    transport.streamNdjson("POST", "/agent/message", {
      params: { ...sessionParams(id), follow: 1 },
      body: { clientMessageId, message: { content: [{ type: "text", text }] } },
      onLine,
    })

  /** Session-local indexed tail: hello {boot,last} first, then {n,line} strictly after `after`.
   *  `line` is the RAW ndjson string — the caller parses/folds it (renderStream shapes). */
  const streamResponse = (id, after, onLine) =>
    transport.streamNdjson("GET", "/agent/stream", {
      params: { ...sessionParams(id), mode: "indexed", after: after > 0 ? after : undefined },
      onLine,
    })

  return { kind, getCapabilities, listSessions, createSession, getSession, getHistory, listModels, setModel, interrupt, streamTurn, streamResponse }
}

module.exports = { createSessionClient, LEGACY }
