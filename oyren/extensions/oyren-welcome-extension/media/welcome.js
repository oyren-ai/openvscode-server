// The welcome page's only script (it carries the CSP nonce). A card click asks the extension to open
// that app BY ID, and the checkbox flips the startup setting; which command an id runs is decided by
// the extension (editorApps.js), never here.
(function () {
  const vscode = acquireVsCodeApi()
  document.addEventListener("click", (event) => {
    const card = event.target instanceof Element ? event.target.closest("[data-open]") : null
    if (card) vscode.postMessage({ type: "open", id: card.getAttribute("data-open") })
  })
  const box = document.getElementById("show-on-startup")
  if (!box) return
  // The page is rebuilt from its first HTML each time its tab is shown again, so the box keeps its
  // own state; the extension sends the setting back when a save fails.
  const show = (value) => {
    box.checked = value
    vscode.setState({ showOnStartup: value })
  }
  const kept = vscode.getState()
  if (kept && typeof kept.showOnStartup === "boolean") box.checked = kept.showOnStartup
  box.addEventListener("change", () => {
    show(box.checked)
    vscode.postMessage({ type: "showOnStartup", value: box.checked })
  })
  window.addEventListener("message", (event) => {
    const message = event.data
    if (message && message.type === "showOnStartup" && typeof message.value === "boolean") show(message.value)
  })
})()
