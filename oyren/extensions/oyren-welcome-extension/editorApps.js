// The tools inside this editor that the welcome page opens with a click. The agent extensions come
// from Open VSX at bake time and are not pinned (composer deploy/editor/install-marketplace-extensions.sh),
// so each card shows only when its extension is on this machine, and runs the FIRST of its steps that
// works: the view container's own open command, then the extension's command, so a command a newer
// version renamed falls through instead of failing.
//
// The page sends only an app id; the commands live here, so a page message can never pick one.
const app = (id, label, blurb, run, extra = {}) => Object.freeze({ id, label, blurb, run: Object.freeze(run), ...extra })
const step = (command, ...args) => Object.freeze({ command, args })

const EDITOR_APPS = Object.freeze([
  app("claude", "Claude Code", "Anthropic's coding agent, in the side bar on the right.",
    [step("workbench.view.extension.claude-sidebar-secondary"), step("claude-vscode.sidebar.open")],
    { extension: "anthropic.claude-code" }),
  app("codex", "Codex", "OpenAI's coding agent, in the side bar on the right.",
    [step("workbench.view.extension.codexSecondaryViewContainer"), step("chatgpt.openSidebar")],
    { extension: "openai.chatgpt" }),
  app("qwen", "Qwen Code", "Qwen's coding agent, in the side bar.",
    [step("qwen-code.focusChat"), step("workbench.view.extension.qwen-code-sidebar")],
    { extension: "qwenlm.qwen-code-vscode-ide-companion" }),
  app("lean", "Lean 4", "Goals and messages for Lean files, in the InfoView beside the editor.",
    [step("lean4.toggleInfoview")], { extension: "leanprover.lean4" }),
  app("agent", "Agent terminal", "The tmux session the launch agent runs in, the one the Codespace Terminal shows.",
    [step("workbench.action.terminal.newWithProfile", { profileName: "Agent" })], { tile: "agent" }),
  app("terminal", "Terminal", "A plain bash shell on this machine.",
    [step("workbench.action.terminal.new")], { tile: "terminal" }),
  app("preview", "Preview", "Open a dev server running on this machine in an editor tab.",
    [step("oyren.preview.open")], { extension: "oyren.oyren-preview", tile: "preview" }),
])

/** The secondary side bar's tool on a fresh workspace: the first of these that is installed. */
const SIDE_BAR_DEFAULTS = Object.freeze(["claude", "codex"])

/** The apps this machine has: extension-backed ones need their extension; the terminals always exist. */
function presentEditorApps(hasExtension) {
  return EDITOR_APPS.filter((candidate) => !candidate.extension || hasExtension(candidate.extension))
}

/** The steps for one app id, or none for an id this list does not define. */
function runsFor(id) {
  const found = EDITOR_APPS.find((candidate) => candidate.id === id)
  return found ? found.run : []
}

/** The app record for an id (the side bar default looks its extension up), or null. */
const editorApp = (id) => EDITOR_APPS.find((candidate) => candidate.id === id) || null

module.exports = { EDITOR_APPS, SIDE_BAR_DEFAULTS, presentEditorApps, runsFor, editorApp }
