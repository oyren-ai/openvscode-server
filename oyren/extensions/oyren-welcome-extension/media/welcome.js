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
  if (box) box.addEventListener("change", () => vscode.postMessage({ type: "showOnStartup", value: box.checked }))
})()
