// The Lean 4 card. vscode-lean4 shows its InfoView only for the ACTIVE Lean editor, and its
// lean4.toggleInfoview closes an InfoView that is already open (vscode-lean4 src/infoview.ts). A click
// on the welcome page leaves the page itself active, so the card first brings a Lean file to the
// front, then runs lean4.displayGoal: that opens the InfoView beside the file, or reveals the open
// one, and never closes it. With no Lean file open, Quick Open lists the workspace's .lean files,
// and the InfoView follows the Lean file picked there (vscode-lean4 opens it by itself only for a
// session's first Lean file).
const LEAN_INFOVIEW_COMMAND = "oyren.welcome.leanInfoview"
/** How long a Quick Open pick is waited for. */
const PICK_MS = 120_000

const isLeanUri = (uri) => Boolean(uri && typeof uri.path === "string" && uri.path.endsWith(".lean"))
const isLeanEditor = (editor) => editor.document.languageId === "lean4" || isLeanUri(editor.document.uri)

async function showLeanInfoview(api) {
  const editor = api.visibleTextEditors().find(isLeanEditor)
  if (editor) {
    await api.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false })
  } else {
    const tab = api.tabGroups.all.flatMap((group) => group.tabs).find((candidate) => isLeanUri(candidate.input && candidate.input.uri))
    if (!tab) {
      const picked = api.nextActiveTextEditor(isLeanEditor, PICK_MS)
      await api.executeCommand("workbench.action.quickOpen", ".lean")
      if (!(await picked)) return undefined
      return api.executeCommand("lean4.displayGoal")
    }
    await api.showTextDocument(tab.input.uri, { viewColumn: tab.group && tab.group.viewColumn, preserveFocus: false })
  }
  return api.executeCommand("lean4.displayGoal")
}

module.exports = { LEAN_INFOVIEW_COMMAND, showLeanInfoview }
