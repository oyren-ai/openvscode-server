// Protocol errors → one friendly sentence for the chat (docs/plans/
// vscode-agent-session-history-client.md "Protocol-capable runtime errors"). These render in the
// transcript, so: no stack traces, no status-code jargon the user can't act on, and NEVER anything
// from the response body or URL (bodies can echo content, URLs carry the token). Pure module.
const { HttpError } = require("./agentHttp")

/** ctx = { kind, port } — the two safe facts every message may use. */
function messageForError(err, ctx) {
  if (err && err.cancelled) return null // user cancellation renders nothing
  const status = err instanceof HttpError ? err.status : 0
  switch (status) {
    case 401:
      return "This editor's session authentication is unavailable, so the agent declined the request. Reload the editor to refresh it."
    case 404:
      return "This chat no longer exists on the server — it may predate the last server restart. The session list has been refreshed."
    case 409:
      return "A turn is already running in this chat. Wait for it to finish (or stop it), then send again."
    case 422:
      return `The ${ctx.kind || "requested"} agent isn't available on this server — it may be missing credentials. The chat stays readable.`
    case 429:
      return "The server's active-agent limit is reached. Close an idle agent chat or retry in a moment."
    default:
      // Connection refused / unexpected status: same one-liner the legacy path always used.
      return `The sandbox agent isn't reachable on 127.0.0.1:${ctx.port}.`
  }
}

module.exports = { messageForError }
