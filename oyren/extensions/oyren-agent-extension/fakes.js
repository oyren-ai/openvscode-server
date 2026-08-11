// Shared unit-test fakes (NOT a test file — the name must not match node --test's patterns).
// The plan's rule: tests use injected/fake `vscode` and HTTP, no test dependencies. These are the
// injected halves: turn constructors matching the pinned-1.109 positional signatures, a mapCtx
// mirroring what sessionProviders.js builds from the real vscode namespace, and tiny stream/token
// doubles for handler-level tests.
class FakeRequestTurn {
  constructor(prompt, command, references, participant, toolReferences, editedFileEvents, id) {
    Object.assign(this, { prompt, command, references, participant, toolReferences, editedFileEvents, id })
  }
}
class FakeResponseTurn {
  constructor(response, result, participant, command) {
    Object.assign(this, { response, result, participant, command })
  }
}
class FakeMarkdownPart {
  constructor(value) { this.value = value }
}

const mapCtx = (kind = "codex-cli") => ({
  kind,
  resourceFor: (id) => ({ scheme: kind, authority: "", path: `/${id}`, query: "", fragment: "" }),
  statuses: { failed: "failed", completed: "completed", inProgress: "inProgress" },
  api: { ChatRequestTurn: FakeRequestTurn, ChatResponseTurn2: FakeResponseTurn, ChatResponseMarkdownPart: FakeMarkdownPart },
})

/** A durable/untitled resource of `kind` — the object shape parseSessionResource accepts. */
const resource = (kind, id, untitled = false) =>
  ({ scheme: kind, authority: "", path: `/${untitled ? "untitled-" : ""}${id}`, query: "", fragment: "" })

/** A ChatResponseStream double that records what rendered. */
const collector = () => {
  const out = { text: [], progress: [] }
  return { out, stream: { markdown: (t) => out.text.push(String(t)), progress: (m) => out.progress.push(m) } }
}

/** A CancellationToken double; fire() triggers every registered listener. */
const fakeToken = () => {
  const subs = []
  return {
    onCancellationRequested: (cb) => { subs.push(cb); return { dispose() { } } },
    fire: () => subs.forEach((cb) => cb()),
  }
}

module.exports = { FakeRequestTurn, FakeResponseTurn, FakeMarkdownPart, mapCtx, resource, collector, fakeToken }
