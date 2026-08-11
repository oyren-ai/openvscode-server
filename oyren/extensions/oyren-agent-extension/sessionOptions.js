// The model picker for a per-agent chat session.
//
// Picking an agent opens a DELEGATED session, which locks the widget to that coding agent
// (lockedToCodingAgent) — and that context key is exactly what hides the ordinary lm-provider model
// picker (OpenModelPickerAction's `when`). Its replacement, ChatSessionPrimaryPickerAction, renders
// only when the session type publishes option groups AND the live session has a value for one. That
// contract is this file: without it a picked agent has NO model UI at all, which is what shipped.
//
// The AVAILABLE list is per KIND (one engine's models, fetched with ?agent=<kind>); the SELECTION is
// per SESSION (modelSelection.js over sessionState). On a legacy runtime both collapse to per-kind.
const vscode = require("vscode")
const { LOADING_ITEM, itemsFor } = require("./modelItems")
const { createModelSelection } = require("./modelSelection")

// 'models' is the upstream convention for this group ('agent' is reserved by core). The id of each
// item is the value posted straight back to POST /agent/model, so it must be the engine's model id.
const GROUP_ID = "models"

/** aware = { state, sessionClient } — absent means legacy-only (kept for tests/compat). */
function createSessionOptions(client, kind, aware = null) {
  // idle → loading → ready | failed. Nothing is fetched at registration: listModels() spawns a real
  // CLI process, and fetching for EVERY kind at boot would start all six agents. `failed` is not
  // sticky: the next session open retries, so one handshake timeout can't hide models forever.
  const cache = { state: "idle", models: [], current: null }
  const { selectionFor, applyChoice } = createModelSelection(client, kind, cache, aware)
  const providerOptions = new vscode.EventEmitter() // groups changed → core re-queries the item list
  const sessionOptions = new vscode.EventEmitter() // a session's selection changed
  const awaitingSelection = [] // sessions opened before the list arrived — each needs its own event
  let inFlight = null

  /** Fetch this kind's models and publish them. Fire-and-forget from provideChatSessionContent: the
   *  ACP handshake behind it can take seconds, and blocking the chat open on it would be the worse
   *  bug. One fetch at a time; the cache serves every later open. */
  function loadModels(resource) {
    if (cache.state === "ready") return // warm: knownSelection already seeded this session
    cache.state = "loading"
    awaitingSelection.push(resource)
    if (inFlight) return
    inFlight = client
      .listModels()
      .then((models) => {
        if (!models.length) throw new Error("engine reported an empty list")
        cache.models = models
        cache.state = "ready"
        // An engine that reports no current model still needs a selection, or the session has no
        // value for the group and the picker stays hidden.
        cache.current = client.state.currentModel || models[0].value
        providerOptions.fire() // real items replace the placeholder…
        awaitingSelection.forEach((pending) => // …and every waiting session selects ITS OWN value
          sessionOptions.fire({ resource: pending, updates: [{ optionId: GROUP_ID, value: selectionFor(pending) }] }))
      })
      .catch((err) => {
        cache.state = "failed"
        providerOptions.fire() // items are now empty — "Loading models…" disappears rather than spin forever
        console.error(`oyren-agent: models for ${kind} failed: ${err && err.message}`)
      })
      .finally(() => { inFlight = null; awaitingSelection.length = 0 })
  }

  return {
    onDidChangeProviderOptions: providerOptions.event,
    onDidChangeSessionOptions: sessionOptions.event,
    emitters: [providerOptions, sessionOptions],
    provideProviderOptions: () => ({ optionGroups: [{ id: GROUP_ID, name: "Model", items: itemsFor(cache) }] }),

    /** The session's starting selection: the loading placeholder until the list lands, the real
     *  value after. The placeholder is the ITEM OBJECT, not its id — object values are exempt from
     *  core's stale-option validity check, so failed→hidden cannot strand an "invalid" flag. */
    knownSelection: (resource) => {
      if (cache.state === "ready" && cache.current) return { [GROUP_ID]: selectionFor(resource) }
      return cache.state === "failed" ? undefined : { [GROUP_ID]: LOADING_ITEM }
    },

    /** The user picked a model — or our own sessionOptions.fire came back around (core forwards
     *  before storing). The loading placeholder echoing back is not a choice; modelSelection
     *  absorbs a real echo (same id ⇒ no second POST). */
    handleOptionsChange: (resource, updates) => {
      for (const update of updates || []) {
        if (!update || update.optionId !== GROUP_ID || !update.value) continue
        const chosen = typeof update.value === "string" ? update.value : update.value.id
        if (chosen === LOADING_ITEM.id) continue
        applyChoice(resource, chosen)
      }
    },

    loadModels,
  }
}

module.exports = { createSessionOptions, GROUP_ID }
