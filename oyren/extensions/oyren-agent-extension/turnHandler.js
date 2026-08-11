// The one chat turn handler, shared by the default participant (the launch agent) and every
// per-agent chat session (sessionProviders.js). Two paths:
//   legacy   — parameter-free calls, one busy latch per ENGINE (client.state). The default
//              participant ALWAYS takes this path; delegated kinds take it on a legacy runtime.
//   session  — protocol v1: resource-aware, one busy latch per logical SESSION (sessionState),
//              untitled→durable commit on first send, agent+session on every call.
// Capability detection picks the path per send, so an old runtime keeps today's behavior verbatim.
const { randomUUID } = require("node:crypto")
const { foldLine, chatSink } = require("./renderStream")
const { LAUNCH_KINDS, handleLaunch } = require("./launchCommands")
const { messageForError } = require("./sessionErrors")

const NO_AGENT = "There is no sandbox agent attached to this editor (no session token), so there is nobody to answer."

/** The picker's choice, when it names one of ours. Delegated sessions usually route model choice
 *  through option groups (sessionOptions.js) instead — then this is null and stored state rules. */
const pickedModel = (request) => (request.model && request.model.vendor === "oyren" ? request.model.id : null)

/** sessionCtx = { kind, sessionClient, state, ensureDurable } — absent for the default participant. */
function makeHandler(client, sessionCtx = null) {
  return async (request, context, stream, token) => {
    const prompt = (request.prompt || "").trim()
    // Slash launches don't need the local agent at all — they talk to the orchestrator.
    if (request.command && LAUNCH_KINDS[request.command]) return handleLaunch(stream, request.command, prompt)
    if (!client.token) return void stream.markdown(NO_AGENT)
    // The runtime 400s an empty message; that must not masquerade as an unreachable agent — and an
    // empty send must never CREATE a server session either, so this check precedes the commit.
    if (!prompt) return void stream.markdown("There is nothing to send — type a message for the agent.")
    const item = sessionCtx ? await protocolItem(sessionCtx, context) : null
    return item ? sessionTurn(client, sessionCtx, item, request, stream, token, prompt)
                : legacyTurn(client, request, stream, token, prompt)
  }
}

/** The open editor's session item — only when the runtime speaks protocol v1 AND the widget told us
 *  which resource this send belongs to. Anything less falls back to the legacy path, which a new
 *  runtime accepts as old-client compatibility (no logical history is guessed at). */
async function protocolItem(sessionCtx, context) {
  const sc = context && context.chatSessionContext
  if (!sc || !sc.chatSessionItem || !sc.chatSessionItem.resource) return null
  const caps = await sessionCtx.sessionClient.getCapabilities().catch(() => ({ legacy: true }))
  return caps.legacy ? null : sc.chatSessionItem
}

/** One turn at a time per ENGINE: each legacy engine is ONE persistent session (Oyren's own chat
 *  pane drives the launch engine too), so a second concurrent turn would double-drive one stream. */
async function legacyTurn(client, request, stream, token, prompt) {
  if (client.state.busy) return void stream.markdown("A turn is already running for this agent.")
  client.state.busy = true
  const subs = []
  try {
    const wanted = pickedModel(request)
    if (wanted) await client.ensureModel(wanted)
    const sink = chatSink(stream)
    const turn = client.streamTurn(prompt, (line) => { if (foldLine(line, sink)) turn.cancel() })
    subs.push(token.onCancellationRequested(() => { client.interrupt().catch(() => {}); turn.cancel() }))
    await turn.done
  } catch {
    // Connection refused / non-200. One sentence, never a stack trace — this renders in the chat.
    stream.markdown(`The sandbox agent isn't reachable on 127.0.0.1:${client.port}.`)
  } finally {
    client.state.busy = false
    for (const sub of subs) sub.dispose()
  }
}

async function sessionTurn(client, ctx, item, request, stream, token, prompt) {
  const { kind, sessionClient, state, ensureDurable } = ctx
  let ref
  try { ref = await ensureDurable(item, prompt) } catch (err) {
    const msg = messageForError(err, { kind, port: client.port })
    return void (msg && stream.markdown(msg)) // failed create: still untitled, still retryable
  }
  const id = ref.id
  // Same-SESSION overlap is blocked; sibling sessions of this kind proceed (server owns the cap).
  if (!state.tryStartTurn(id)) return void stream.markdown("A turn is already running in this chat. Wait for it to finish (or stop it), then send again.")
  const subs = []
  try {
    const wanted = pickedModel(request)
    // Switch only on a KNOWN difference, and only THIS session's model; best-effort like legacy.
    if (wanted && state.modelFor(id) !== wanted) {
      try { await sessionClient.setModel(id, wanted); state.setModel(id, wanted) } catch { /* turn runs on current */ }
    }
    const sink = chatSink(stream)
    const turn = sessionClient.streamTurn(id, prompt, ref.firstMessageId || randomUUID(), (line) => { if (foldLine(line, sink)) turn.cancel() })
    // Cancel interrupts the SAME kind/session pair and closes only this read stream.
    subs.push(token.onCancellationRequested(() => { sessionClient.interrupt(id).catch(() => {}); turn.cancel() }))
    await turn.done
  } catch (err) {
    const msg = messageForError(err, { kind, port: client.port })
    if (msg) stream.markdown(msg)
  } finally {
    state.endTurn(id) // this session's latch ONLY — a canceled socket must not clear a sibling's
    for (const sub of subs) sub.dispose()
  }
}

module.exports = { makeHandler }
