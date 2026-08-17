// The six delegated agents in the chat's agent-type (monitor) dropdown. Each `chatSessions`
// contribution in package.json gets an item provider + content provider here; picking one opens a
// chat locked to that agent. With a protocol-v1 runtime the item list is the server's session list
// and reopening an item restores its transcript (sessionItems/sessionContent); on a legacy runtime
// every hook collapses to the shipped behavior — no enumerable history, sessions live as open tabs.
//
// The picker itself only lists these on our patched build (stock upstream filters contributions
// through a hardcoded allowlist); on a stock build the contributions are inert, not broken.
// KINDS now lives in sessionResource.js (the URI layer needs the schemes); re-exported unchanged.
const vscode = require("vscode")
const { createClient } = require("./agentClient")
const { createSessionClient } = require("./sessionClient")
const { createSessionState } = require("./sessionState")
const { createSessionOptions } = require("./sessionOptions")
const { createCommitMachine } = require("./sessionCommit")
const { createItemLister } = require("./sessionItems")
const { createContentResolver } = require("./sessionContent")
const { makeHandler } = require("./turnHandler")
const { KINDS, durablePath } = require("./sessionResource")
const { recordLastSession } = require("./lastSessionStore")

// The pinned-1.109 pieces the pure modules must not require. Statuses tolerate the proposal being
// absent (status is optional on an item); the turn constructors are checked at use in mapCtx.api.
const statusEnum = () => {
  const s = vscode.ChatSessionStatus || {}
  return { failed: s.Failed, completed: s.Completed, inProgress: s.InProgress }
}

/** Register item + content providers for every agent kind. Failures are logged, never thrown —
 *  on builds without the chatSessionsProvider proposal these APIs are simply absent. */
function registerSessionProviders(context) {
  if (!vscode.chat || typeof vscode.chat.registerChatSessionContentProvider !== "function") return
  // ONE state instance for the whole extension: busy/model/cursor keys are durable session UUIDs
  // (globally unique), and the item cache is keyed by kind — nothing here can alias across kinds.
  const state = createSessionState()
  // Server-side "most recently touched session" record, for cross-device reattach (reattach.js).
  // globalStorageUri lives on the droplet; globalState would be browser IndexedDB and lie here.
  const storageDir = context.globalStorageUri && context.globalStorageUri.fsPath
  const touch = (resource) => { if (storageDir) recordLastSession(storageDir, String(resource)) }
  for (const { type } of KINDS) {
    try {
      // LEGACY calls for the session's own kind carry no ?agent= — the primary engine IS that agent
      // and the runtime rejects ?agent=<launch kind>. PROTOCOL calls (sessionClient) always carry
      // the kind verbatim: an explicit logical session is a side session even for the launch kind.
      const legacyKind = type === (process.env.AGENT_KIND || "") ? null : type
      const client = createClient(process.env, legacyKind)
      const sessionClient = createSessionClient(type, client.transport)
      const itemsChanged = new vscode.EventEmitter()
      const commit = new vscode.EventEmitter() // extension-owned: VS Code migrates untitled→durable on it
      context.subscriptions.push(itemsChanged, commit)
      const mapCtx = {
        kind: type,
        resourceFor: (id) => vscode.Uri.from({ scheme: type, path: durablePath(id) }),
        statuses: statusEnum(),
        api: { ChatRequestTurn: vscode.ChatRequestTurn, ChatResponseTurn2: vscode.ChatResponseTurn2, ChatResponseMarkdownPart: vscode.ChatResponseMarkdownPart },
      }
      const { ensureDurable } = createCommitMachine({
        kind: type, sessionClient, state, mapCtx,
        fireCommit: (e) => commit.fire(e), fireItemsChanged: () => itemsChanged.fire(),
      })
      // The participant id MUST be the session type verbatim: a delegated session locks the chat
      // widget to agent id === chatSessions type, and any other id dies at send with
      // `No activated agent with id "<type>"`.
      const handler = makeHandler(client, { kind: type, sessionClient, state, ensureDurable })
      const participant = vscode.chat.createChatParticipant(type, handler)
      context.subscriptions.push(participant)
      context.subscriptions.push(vscode.chat.registerChatSessionItemProvider(type, {
        onDidChangeChatSessionItems: itemsChanged.event,
        onDidCommitChatSessionItem: commit.event,
        provideChatSessionItems: createItemLister({ kind: type, sessionClient, state, mapCtx }),
      }))
      // The model picker of a delegated session comes from these option hooks, not from the lm
      // provider — see sessionOptions.js. Opening the session is what loads the list.
      const options = createSessionOptions(client, type, { state, sessionClient })
      context.subscriptions.push(...options.emitters)
      const contentResolver = createContentResolver({
        kind: type, sessionClient, state, options, handler, mapCtx,
        port: client.port, fireItemsChanged: () => itemsChanged.fire(),
      })
      context.subscriptions.push(vscode.chat.registerChatSessionContentProvider(type, {
        onDidChangeChatSessionProviderOptions: options.onDidChangeProviderOptions,
        onDidChangeChatSessionOptions: options.onDidChangeSessionOptions,
        provideChatSessionProviderOptions: options.provideProviderOptions,
        provideHandleOptionsChange: options.handleOptionsChange,
        provideChatSessionContent: (resource, cancelToken) => {
          touch(resource) // opening a session IS touching it (untitled resources are filtered)
          return contentResolver(resource, cancelToken)
        },
      }, participant, { supportsInterruptions: true }))
    } catch (err) {
      console.error(`oyren-agent: session provider for ${type} failed: ${err && err.message}`)
    }
  }
}

module.exports = { registerSessionProviders, KINDS }
