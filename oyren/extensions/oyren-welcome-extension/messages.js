// Messages from the welcome page. The page can ask for exactly two things: open one of the apps
// editorApps.js lists, by its id, or save the "show on startup" checkbox. The commands an id runs
// live in editorApps.js, so nothing the page sends can name a command.
const { runFirst } = require("./startup")
const { runsFor } = require("./editorApps")

async function handleMessage(api, message, saveShowOnStartup) {
  if (!message || typeof message !== "object") return
  if (message.type === "open" && typeof message.id === "string") await runFirst(api, runsFor(message.id))
  if (message.type === "showOnStartup" && typeof message.value === "boolean") await saveShowOnStartup(message.value)
}

module.exports = { handleMessage }
