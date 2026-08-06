// The option items a per-agent session's model picker shows, by fetch state (see sessionOptions.js).
const vscode = require("vscode")

// Fetching the list spawns the real CLI and waits out an ACP handshake — long enough that "picker
// appears later" reads as "there is no picker". So while the fetch runs the group holds this one
// locked (greyed, non-interactive, spinning) item, and the session's option is seeded with it: both
// halves of core's render gate (items in the group + a value on the session) hold from first paint.
// NOT `default: true` — a default item WITH an icon renders icon-only and would eat the label.
const LOADING_ITEM = Object.freeze({
  id: "__loading",
  name: "Loading models…",
  locked: true,
  icon: new vscode.ThemeIcon("loading~spin"),
})

/** The picker's item list for the current fetch state: the real models once ready, the spinning
 *  placeholder before that ("idle" included — the group registers at editor boot, long before any
 *  session opens), and nothing after a failure — an absent picker over a lying one. */
const itemsFor = (cache) => {
  if (cache.state === "ready")
    return cache.models.map((m) => ({ id: m.value, name: m.displayName || m.value, default: m.value === cache.current }))
  return cache.state === "failed" ? [] : [LOADING_ITEM]
}

module.exports = { LOADING_ITEM, itemsFor }
