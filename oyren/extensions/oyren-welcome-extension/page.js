// The welcome page's HTML. Pure: everything shown arrives in `model`, and every string is escaped
// before it is placed. The CSP admits only this webview's own files (stylesheet, extension icons) and
// the one script carrying the nonce: no remote loads, no inline styles, and no connect-src at all, so
// the page cannot reach the network or report anything anywhere.
const { TILES } = require("./tiles")

// The Oyren "O" mark, the one the fork's chat welcome drew (commit c007436), coloured by the theme.
const OYREN_MARK = '<svg class="mark" viewBox="133 262 534 276" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path fill-rule="evenodd" d="M271 262h258a138 138 0 0 1 0 276H271a138 138 0 0 1 0-276Zm38 87h182a51 51 0 0 1 0 102H309a51 51 0 0 1 0-102Z"/></svg>'

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ENTITIES[char])
/** Escaped text with `command` spans as <code>, the only markup a blurb may carry. */
const rich = (value) => esc(value).replace(/`([^`]+)`/g, "<code>$1</code>")

function csp({ cspSource, nonce }) {
  return [`default-src 'none'`, `img-src ${cspSource}`, `style-src ${cspSource}`, `script-src 'nonce-${nonce}'`].join("; ")
}

const iconOf = (app) => (app.iconUri ? `<img class="tile" src="${esc(app.iconUri)}" alt="">` : TILES[app.tile] || "")

const text = (app) => `<span class="name">${esc(app.label)}</span><span class="blurb">${rich(app.blurb)}</span>`

const editorCard = (app) =>
  `<li><button type="button" class="card" data-open="${esc(app.id)}">${iconOf(app)}<span class="text">${text(app)}</span></button></li>`

function codespaceCard(app) {
  const here = app.id === "vscode" ? '<span class="here">You are here</span>' : ""
  return `<li class="card static" data-app="${esc(app.id)}">${app.tile}<span class="text">${text(app)}${here}</span></li>`
}

const facts = (list) =>
  `<dl class="facts">${list.map((fact) => `<div><dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd></div>`).join("")}</dl>`

function section(id, heading, hint, body) {
  return `<section aria-labelledby="${id}"><h2 id="${id}">${heading}</h2>${hint ? `<p class="hint">${hint}</p>` : ""}${body}</section>`
}

function renderPage(model) {
  const dock = model.codespaceApps.filter((app) => app.opened === "dock")
  const byCommand = model.codespaceApps.filter((app) => app.opened === "command")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(model)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${esc(model.styleUri)}">
<title>Welcome</title></head>
<body><main>
<header class="hero">${OYREN_MARK}<div><h1>${esc(model.title)}</h1>${model.subtitle ? `<p class="sub">${esc(model.subtitle)}</p>` : ""}</div></header>
${section("this-codespace", "This Codespace", "", facts(model.facts))}
${section("in-this-editor", "In this editor", "Click one to open it.", `<ul class="grid">${model.editorApps.map(editorCard).join("")}</ul>`)}
${section("in-your-codespace", "Apps in your Codespace", "Open these from the Codespace dock.",
    `<ul class="grid">${dock.map(codespaceCard).join("")}</ul><h3>Opened by a command</h3><ul class="grid">${byCommand.map(codespaceCard).join("")}</ul>`)}
<footer><label class="startup"><input type="checkbox" id="show-on-startup"${model.showOnStartup ? " checked" : ""}> Show this page when the editor starts with no files open</label>
<p class="hint">Open it again any time: Command Palette, then <code>Oyren: Codespace Welcome</code>.</p></footer>
</main><script nonce="${esc(model.nonce)}" src="${esc(model.scriptUri)}"></script></body></html>`
}

module.exports = { renderPage, esc }
