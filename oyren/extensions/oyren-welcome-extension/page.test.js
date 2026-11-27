// The welcome page's HTML: a strict CSP with one nonce'd script and nothing remote, every app with its
// icon, and every piece of text escaped.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { renderPage } = require("./page")
const { CODESPACE_APPS } = require("./codespaceApps")
const { EDITOR_APPS } = require("./editorApps")

const BASE = "https://webview.example/res"
const model = (overrides = {}) => ({
  nonce: "n0nce", cspSource: "https://webview.example", styleUri: `${BASE}/welcome.css`, scriptUri: `${BASE}/welcome.js`,
  title: "Welcome to your Codespace", subtitle: "leanprover-community/riemann-hypothesis",
  facts: [{ label: "Repository", value: "leanprover-community/riemann-hypothesis" }, { label: "Machine", value: "4 vCPU · 8 GB RAM" }],
  editorApps: EDITOR_APPS.map((app) => ({ ...app, iconUri: app.extension ? `${BASE}/${app.id}.png` : null })),
  codespaceApps: CODESPACE_APPS, showOnStartup: true, ...overrides,
})

test("the CSP allows this webview's own files and one nonce'd script, nothing else", () => {
  const html = renderPage(model())
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]
  assert.equal(csp, "default-src 'none'; img-src https://webview.example; style-src https://webview.example; script-src 'nonce-n0nce'")
  assert.match(html, /<script nonce="n0nce" src="https:\/\/webview\.example\/res\/welcome\.js"><\/script>/)
  assert.equal((html.match(/<script/g) || []).length, 1)
  assert.ok(!/\sstyle=/.test(html), "inline styles would be blocked by the CSP")
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(url.startsWith(BASE), url)
})

test("every Codespace app is on the page with its tile, and VS Code says you are here", () => {
  const html = renderPage(model())
  for (const app of CODESPACE_APPS) {
    assert.ok(html.includes(`>${app.label}<`), app.label)
    assert.ok(html.includes(app.tile), `${app.id} tile`)
  }
  assert.match(html, /data-app="vscode"[^]*?You are here/)
  assert.match(html, /<code>oyren files<\/code>/)
})

test("every in-editor app is a button carrying only its id, with its extension's own icon", () => {
  const html = renderPage(model())
  for (const app of EDITOR_APPS) {
    assert.match(html, new RegExp(`<button type="button" class="card" data-open="${app.id}">`))
    if (app.extension) assert.ok(html.includes(`<img class="tile" src="${BASE}/${app.id}.png" alt="">`), app.id)
  }
})

test("text from the machine is escaped", () => {
  const html = renderPage(model({ subtitle: "<b>x</b>", facts: [{ label: "Folder", value: '<img src=x onerror="alert(1)">' }] }))
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"))
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"))
  assert.ok(!html.includes("<img src=x"))
})

test("the startup checkbox reflects the setting", () => {
  assert.match(renderPage(model()), /<input type="checkbox" id="show-on-startup" checked>/)
  assert.match(renderPage(model({ showOnStartup: false })), /<input type="checkbox" id="show-on-startup">/)
})
