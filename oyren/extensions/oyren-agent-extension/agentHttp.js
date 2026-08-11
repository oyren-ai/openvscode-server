// The one HTTP transport under both clients (legacy agentClient.js, protocol sessionClient.js).
// URLs are built with URL/URLSearchParams — never string concatenation — so a hostile session id or
// model id cannot smuggle a second query parameter. Errors carry status + path and NOTHING else:
// the token lives only in the query string, so no error message, log line, or test snapshot may
// ever contain a full URL or a response body (bodies can echo request content).
const http = require("node:http")

/** Status-preserving error. `message` is built from path+status only — safe to log verbatim. */
class HttpError extends Error {
  constructor(path, status) { super(`${path} responded ${status}`); this.status = status; this.path = path }
}
class CancelledError extends Error {
  constructor() { super("cancelled"); this.cancelled = true }
}

function createTransport(env = process.env) {
  const port = Number(env.PORT || 8080) // the runtime's single routed port
  const token = env.SESSION_TOKEN || ""

  function makeUrl(path, params = {}) {
    const u = new URL(`http://127.0.0.1:${port}${path}`)
    u.searchParams.set("token", token)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
    return u
  }

  /** One JSON request. Any 2xx resolves (create answers 201, its idempotent retry 200). `token` is
   *  a VS Code CancellationToken and only ever cancels the READ — it is not a credential. */
  function requestJson(method, path, { params, body, token: cancelToken } = {}) {
    let sub
    return new Promise((resolve, reject) => {
      const req = http.request(makeUrl(path, params), { method, headers: { "content-type": "application/json" } }, (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("error", reject)
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode > 299) return reject(new HttpError(path, res.statusCode))
          try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}) } catch { reject(new HttpError(path, res.statusCode)) }
        })
      })
      req.on("error", reject)
      if (cancelToken && typeof cancelToken.onCancellationRequested === "function")
        sub = cancelToken.onCancellationRequested(() => { reject(new CancelledError()); try { req.destroy() } catch { /* gone */ } })
      req.end(body === undefined ? undefined : JSON.stringify(body))
    }).finally(() => { if (sub) sub.dispose() })
  }

  /**
   * One NDJSON stream (POST /agent/message?follow=1, GET /agent/stream?mode=indexed). Lines split
   * across TCP chunks are reassembled before parsing; a line that still isn't JSON is dropped —
   * half a line or junk must never kill the read. Cancel = stop READING and resolve quietly
   * (interrupt is a separate call); the server closing is the normal end.
   */
  function streamNdjson(method, path, { params, body, onLine }) {
    let cancel = () => {}
    const done = new Promise((resolve, reject) => {
      const req = http.request(makeUrl(path, params), { method, headers: { "content-type": "application/json" } }, (res) => {
        if (res.statusCode < 200 || res.statusCode > 299) { res.resume(); return reject(new HttpError(path, res.statusCode)) }
        let tail = ""
        const emit = (line) => {
          if (!line.trim()) return
          try { onLine(JSON.parse(line)) } catch { /* partial tail or junk */ }
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
      cancel = () => { resolve(); try { req.destroy() } catch { /* already gone */ } }
      req.end(body === undefined ? undefined : JSON.stringify(body))
    })
    return { done, cancel: () => cancel() }
  }

  return { port, token, requestJson, streamNdjson }
}

module.exports = { createTransport, HttpError, CancelledError }
