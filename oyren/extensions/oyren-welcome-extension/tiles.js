// App tiles as inline SVG, the hosted dock's design (icons/Tile.tsx): one neutral rounded plate with
// a hairline ring, and the identity carried by the mark on it. Colours are classes, painted by
// media/welcome.css with the hosted palette for the light and the dark theme; the brand marks keep
// their own fixed colours. Inline SVG is markup, not a fetch, so the page's CSP needs no image source
// for these.
const { ZED_MARK, DEEPSEEK_MARK, VSCODE_MARK, CHROMIUM_SECTORS, GLYPHS, LUCIDE } = require("./brandMarks")

// The hosted transforms: glyphs drawn in the 8-16 band grow to dock size, full-box brand marks sit in
// the plate with even margins, and lucide's 24-box is drawn 13 units wide from (5.5, 5.5).
const GLYPH_TRANSFORM = "translate(12 12) scale(1.2) translate(-12 -12)"
const MARK_TRANSFORM = "translate(5 5) scale(0.5833)"
const LUCIDE_TRANSFORM = "translate(5.5 5.5) scale(0.5417)"
const STROKE = 'fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'

// Two glyphs of our own for in-editor tools with no extension icon: a four-point sparkle (the
// machine settings' icon for the Agent terminal profile) and a small browser window (Preview).
const SPARKLE = "M12 7.6l1.1 3.3 3.3 1.1-3.3 1.1L12 16.4l-1.1-3.3L7.6 12l3.3-1.1z"
const WINDOW = "M7.5 8h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM6.5 10.5h11"

function plate(inner) {
  return '<svg class="tile" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
    + '<rect class="plate" x="1" y="1" width="22" height="22" rx="6.5"/>'
    + '<rect class="ring" x="1.5" y="1.5" width="21" height="21" rx="6" fill="none"/>'
    + `${inner}</svg>`
}

const glyph = (tone, d) => plate(`<g transform="${GLYPH_TRANSFORM}" class="stroke-${tone}" ${STROKE}><path d="${d}"/></g>`)
const mark = (inner) => plate(`<g transform="${MARK_TRANSFORM}">${inner}</g>`)
const lucide = (paths) =>
  plate(`<g transform="${LUCIDE_TRANSFORM}" class="stroke-primary" ${STROKE}>${paths.map((d) => `<path d="${d}"/>`).join("")}</g>`)

const chromium = CHROMIUM_SECTORS.map(({ d, tone }) => `<path class="fill-${tone}" d="${d}"/>`).join("")
  + '<circle class="fill-background" cx="12" cy="12" r="5.6"/><circle class="fill-primary" cx="12" cy="12" r="4.4"/>'

const TILES = Object.freeze({
  zed: mark(`<path class="fill-zed" d="${ZED_MARK}"/>`),
  vscode: mark(`<path fill="#007ACC" d="${VSCODE_MARK}"/>`),
  terminal: glyph("terminal", GLYPHS.terminal),
  chat: glyph("chat", GLYPHS.chat),
  deepseek: mark(`<path fill="#4D6BFE" d="${DEEPSEEK_MARK}"/>`),
  browser: mark(chromium),
  docs: glyph("primary", GLYPHS.docs),
  files: lucide(LUCIDE.files),
  agent: glyph("chat", SPARKLE),
  preview: glyph("primary", WINDOW),
})

module.exports = { TILES }
