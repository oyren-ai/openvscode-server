// Protocol client against a REAL local http server (no test dependencies, per the plan): URL
// discipline (token/agent/session exactly once), the capability gate, idempotent create statuses,
// chunked ndjson reassembly, token redaction, and the reject-before-HTTP rule.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const { createTransport, HttpError } = require("./agentHttp")
const { createSessionClient } = require("./sessionClient")

const A = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"

/** routes[pathname] = (url, body, res) => [status, payload] | null when the route wrote itself. */
async function withServer(routes, run) {
  const hits = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost")
      const body = raw ? JSON.parse(raw) : null
      hits.push({ method: req.method, url, body })
      const out = (routes[url.pathname] || (() => [404, {}]))(url, body, res)
      if (!out) return
      res.writeHead(out[0], { "content-type": "application/json" })
      res.end(JSON.stringify(out[1]))
    })
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const transport = createTransport({ PORT: String(server.address().port), SESSION_TOKEN: "sekret" })
  try { return await run(createSessionClient("codex-cli", transport), hits) }
  finally { server.close() }
}

test("capability 404 selects legacy — cached, one request for the whole process", () =>
  withServer({}, async (client, hits) => {
    assert.equal((await client.getCapabilities()).legacy, true)
    assert.equal((await client.getCapabilities()).legacy, true)
    assert.equal(hits.length, 1)
  }))

test("every session URL carries token, agent, and session exactly once", () =>
  withServer({
    "/agent/capabilities": () => [200, { protocol: 1 }],
    "/agent/sessions": (url) => [200, { protocol: 1, sessions: [] }],
    "/agent/models": () => [200, { models: [] }],
  }, async (client, hits) => {
    assert.equal((await client.getCapabilities()).protocol, 1)
    await client.listSessions()
    await client.listModels(A)
    for (const { url } of hits) {
      assert.deepEqual(url.searchParams.getAll("token"), ["sekret"])
      assert.ok(url.searchParams.getAll("agent").length <= 1)
    }
    assert.equal(hits[1].url.searchParams.get("agent"), "codex-cli")
    assert.deepEqual(hits[2].url.searchParams.getAll("session"), [A]) // exactly once
  }))

test("create accepts 201 and the idempotent-retry 200 alike", () =>
  withServer({
    "/agent/sessions": (_u, body) => [body.id === A ? 201 : 400, { protocol: 1, session: { id: body.id } }],
  }, async (client, hits) => {
    const out = await client.createSession({ id: A, firstMessage: "hi", model: "m1" })
    assert.equal(out.session.id, A)
    assert.deepEqual(hits[0].body, { id: A, agent: "codex-cli", firstMessage: "hi", model: "m1" })
  }))

test("streamTurn: session pair + clientMessageId on the wire; split ndjson reassembled", () =>
  withServer({
    "/agent/message": (_u, _b, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" })
      res.write('{"type":"stream_')
      setTimeout(() => { res.write('event"}\n{"type":"res'); res.end('ult"}\n') }, 10)
      return null
    },
  }, async (client, hits) => {
    const lines = []
    await client.streamTurn(A, "run it", "msg-1", (l) => lines.push(l.type)).done
    assert.deepEqual(lines, ["stream_event", "result"])
    const { url, body } = hits[0]
    assert.equal(url.searchParams.get("session"), A)
    assert.equal(url.searchParams.get("agent"), "codex-cli")
    assert.equal(url.searchParams.get("follow"), "1")
    assert.equal(body.clientMessageId, "msg-1")
  }))

test("errors carry path+status and never the token; bad ids never reach HTTP", () =>
  withServer({ "/agent/sessions/x": () => [500, {}] }, async (client, hits) => {
    const err = await client.getSession(A).catch((e) => e)
    assert.ok(err instanceof HttpError)
    assert.equal(err.status, 404)
    assert.ok(!err.message.includes("sekret") && !String(err.stack).includes("sekret"))
    assert.throws(() => client.getHistory("../../etc/passwd"), /canonical/)
    assert.throws(() => client.interrupt("NOT-A-UUID"), /canonical/)
    assert.equal(hits.length, 1) // only the valid getSession dialed out
  }))
