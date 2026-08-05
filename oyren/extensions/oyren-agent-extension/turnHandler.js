// The one chat turn handler, shared by the default participant (the launch agent) and every
// per-agent chat session (sessionProviders.js) — the only difference between them is which client
// they hold, and the client already knows its ?agent= kind.
const { foldLine, chatSink } = require("./renderStream")
const { launchAgent } = require("./launchClient")

const NO_AGENT = "There is no sandbox agent attached to this editor (no session token), so there is nobody to answer."
const BUSY = "A turn is already running for this agent."

// /codex-style slash commands on the DEFAULT participant: each launches a NEW paid session running
// that agent, with the typed text as its first task (docs/oyren-chat-launch.md). Distinct from the
// agent-type dropdown, which runs a SIDE engine on THIS machine — a launch is a fresh sandbox.
const LAUNCH_KINDS = {
  claude: "claude-code", codex: "codex-cli", cursor: "cursor-cli", gemini: "gemini-cli",
  opencode: "opencode", qwen: "qwen-code", antigravity: "antigravity-cli",
}

async function handleLaunch(stream, command, prompt) {
  if (!prompt) return void stream.markdown(`Add the first task after the command — e.g. \`/${command} fix the failing tests\`.`)
  stream.progress(`Launching a new ${command} session…`)
  const text = await launchAgent(LAUNCH_KINDS[command], prompt)
  stream.markdown(text)
  // The tool's reply names the session id; make it a door, not just a fact.
  const id = /session ([0-9a-f-]{8,})/i.exec(text)
  if (id) stream.markdown(`\n\n[Open the session](https://oyren.ai/session/${id[1]})`)
}

/** One turn at a time, enforced with the latch on client.state: each engine is ONE persistent
 *  session (Oyren's own chat pane drives the launch engine too), so a second concurrent turn would
 *  not run in parallel — it would double-drive the same stream. */
function makeHandler(client) {
  return async (request, _context, stream, token) => {
    const prompt = (request.prompt || "").trim()
    // Slash launches don't need the local agent at all — they talk to the orchestrator.
    if (request.command && LAUNCH_KINDS[request.command]) return handleLaunch(stream, request.command, prompt)
    if (!client.token) return void stream.markdown(NO_AGENT)
    if (client.state.busy) return void stream.markdown(BUSY)
    // The runtime 400s an empty message; that must not masquerade as an unreachable agent below.
    if (!prompt) return void stream.markdown("There is nothing to send — type a message for the agent.")
    client.state.busy = true
    const subs = []
    try {
      // The picker's choice arrives as request.model; the session only follows it if told.
      if (request.model && request.model.vendor === "oyren") await client.ensureModel(request.model.id)
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
}

module.exports = { makeHandler }
