// Terminal image paste: the extension-host half. The workbench reads an image off the browser
// clipboard and hands it here as base64; this side writes it into a private per-user directory in
// the sandbox and returns the absolute path, which the workbench types into the terminal (so a CLI
// agent like Claude Code can attach it). Tests run against a real temp directory, no fs fakes.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")

const {
  saveTerminalPaste,
  cleanupPasteSession,
  registerTerminalPaste,
  sniffImageType,
  MAX_PASTE_BYTES,
  PASTE_IMAGE_COMMAND,
  CLEANUP_PASTE_SESSION_COMMAND,
} = require("./terminalPaste")

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(32, 1)])
const JPEG = Buffer.concat([Buffer.from("ffd8ffe000104a464946", "hex"), Buffer.alloc(32, 2)])
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32, 3)])
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 4)])
const BMP = Buffer.concat([Buffer.from("BM"), Buffer.alloc(32, 5)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const SESSION_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
const SESSION_B = "f0e1d2c3b4a5968778695a4b3c2d1e0f"

function tmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-paste-test-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const mode = (p) => fs.statSync(p).mode & 0o777

test("sniffImageType recognises the allowlisted formats by their magic bytes only", () => {
  assert.strictEqual(sniffImageType(PNG), "png")
  assert.strictEqual(sniffImageType(JPEG), "jpg")
  assert.strictEqual(sniffImageType(GIF), "gif")
  assert.strictEqual(sniffImageType(WEBP), "webp")
  assert.strictEqual(sniffImageType(BMP), "bmp")
  assert.strictEqual(sniffImageType(SVG), undefined)
  assert.strictEqual(sniffImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt ")), undefined)
  assert.strictEqual(sniffImageType(Buffer.alloc(0)), undefined)
})

test("writes the image 0600 into a 0700 per-session subdirectory and returns its absolute path", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const res = saveTerminalPaste({ base64: PNG.toString("base64"), mime: "image/png", sessionId: SESSION_A }, { dir })
  assert.ok(res.path, `expected a path, got ${JSON.stringify(res)}`)
  assert.ok(path.isAbsolute(res.path))
  const sessionDir = path.dirname(res.path)
  assert.strictEqual(sessionDir, path.join(dir, SESSION_A))
  assert.match(path.basename(res.path), /^paste-[0-9a-f]{32}\.png$/)
  assert.deepStrictEqual(fs.readFileSync(res.path), PNG)
  assert.strictEqual(mode(res.path), 0o600)
  assert.strictEqual(mode(sessionDir), 0o700)
  assert.strictEqual(mode(dir), 0o700)
})

test("assigns an unguessable 0700 session subdirectory when sessionId is omitted", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const res = saveTerminalPaste({ base64: PNG.toString("base64"), mime: "image/png" }, { dir })
  assert.ok(res.path)
  const sessionDir = path.dirname(res.path)
  assert.strictEqual(path.dirname(sessionDir), dir)
  assert.match(path.basename(sessionDir), /^[0-9a-f]{32}$/)
  assert.strictEqual(mode(sessionDir), 0o700)
})

test("rejects malformed or path-traversal sessionId values", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  for (const badSession of ["", "short", "../escape", "a/b/c", "A1B2C3D4E5F60718293A4B5C6D7E8F90", 123, {}]) {
    const res = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: badSession }, { dir })
    assert.ok(res.error, `expected error for sessionId ${JSON.stringify(badSession)}`)
  }
})

test("the extension comes from the bytes, not from the client's mime", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const res = saveTerminalPaste({ base64: JPEG.toString("base64"), mime: "image/png", sessionId: SESSION_A }, { dir })
  assert.match(res.path, /\.jpg$/)
  // mime is optional: Chrome's async clipboard always reports image/png, the bytes decide.
  assert.match(saveTerminalPaste({ base64: GIF.toString("base64"), sessionId: SESSION_A }, { dir }).path, /\.gif$/)
})

test("each paste gets its own file", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const a = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir }).path
  const b = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir }).path
  assert.notStrictEqual(a, b)
  assert.strictEqual(fs.readdirSync(path.join(dir, SESSION_A)).length, 2)
})

test("rejects SVG and other non-image payloads, whatever mime the client claims", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  assert.ok(saveTerminalPaste({ base64: SVG.toString("base64"), mime: "image/svg+xml" }, { dir }).error)
  assert.ok(saveTerminalPaste({ base64: SVG.toString("base64"), mime: "image/png" }, { dir }).error)
  assert.ok(saveTerminalPaste({ base64: PNG.toString("base64"), mime: "image/svg+xml" }, { dir }).error)
  assert.ok(saveTerminalPaste({ base64: PNG.toString("base64"), mime: "text/html" }, { dir }).error)
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0)
})

test("rejects missing or malformed arguments without throwing", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  for (const bad of [undefined, null, {}, { base64: "" }, { base64: 42 }, "iVBORw0KGgo="]) {
    const res = saveTerminalPaste(bad, { dir })
    assert.ok(res.error, `expected an error for ${JSON.stringify(bad)}`)
  }
})

test("rejects images over 10 MiB before decoding them", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_PASTE_BYTES)])
  const res = saveTerminalPaste({ base64: big.toString("base64"), mime: "image/png" }, { dir })
  assert.match(res.error, /10 MB/)
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0)
  // exactly at the limit is fine
  const atLimit = Buffer.concat([PNG, Buffer.alloc(MAX_PASTE_BYTES - PNG.length)])
  assert.ok(saveTerminalPaste({ base64: atLimit.toString("base64") }, { dir }).path)
})

test("ignores any path or name the client sends", (t) => {
  const root = tmpRoot(t)
  const dir = path.join(root, "pastes")
  const res = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A, path: path.join(root, "evil.png"), name: "../../evil.png", dir: root }, { dir })
  assert.strictEqual(path.dirname(res.path), path.join(dir, SESSION_A))
  assert.ok(!fs.existsSync(path.join(root, "evil.png")))
})

test("tightens an existing group/world-readable directory to 0700", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  fs.mkdirSync(dir, { mode: 0o755 })
  fs.chmodSync(dir, 0o755)
  assert.ok(saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir }).path)
  assert.strictEqual(mode(dir), 0o700)
  assert.strictEqual(mode(path.join(dir, SESSION_A)), 0o700)
})

test("refuses a paste directory or session subdirectory that is a symlink", (t) => {
  const root = tmpRoot(t)
  const target = path.join(root, "elsewhere")
  fs.mkdirSync(target, { mode: 0o700 })
  const dir = path.join(root, "pastes")
  fs.symlinkSync(target, dir)
  const res = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir })
  assert.ok(res.error)
  assert.strictEqual(fs.readdirSync(target).length, 0)

  fs.unlinkSync(dir)
  fs.mkdirSync(dir, { mode: 0o700 })
  fs.symlinkSync(target, path.join(dir, SESSION_A))
  const resSub = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir })
  assert.ok(resSub.error)
  assert.strictEqual(fs.readdirSync(target).length, 0)
})

test("refuses a paste directory owned by someone else", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  fs.mkdirSync(dir, { mode: 0o700 })
  const res = saveTerminalPaste({ base64: PNG.toString("base64") }, { dir, uid: os.userInfo().uid + 1 })
  assert.ok(res.error)
  assert.strictEqual(fs.readdirSync(dir).length, 0)
})

test("prunes expired files and empty session directories past TTL, and timer deletes after TTL", async (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const first = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir, ttlMs: 1000, now: 10_000 }).path
  const oldSec = 5
  fs.utimesSync(first, oldSec, oldSec)
  assert.ok(fs.existsSync(first))

  // Next paste at t=10_000 (5000ms > ttlMs=1000ms) prunes the expired file and its empty session dir.
  const second = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_B }, { dir, ttlMs: 1000, now: 10_000 }).path
  assert.ok(!fs.existsSync(first))
  assert.ok(!fs.existsSync(path.join(dir, SESSION_A)))
  assert.ok(fs.existsSync(second))

  // Timer-driven cleanup removes a file automatically when scheduleCleanup is enabled.
  const timed = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir, ttlMs: 40, scheduleCleanup: true }).path
  assert.ok(fs.existsSync(timed))
  await new Promise((r) => setTimeout(r, 90))
  assert.ok(!fs.existsSync(timed))
})

test("enforces aggregate file-count and byte quotas by evicting oldest pastes first", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const p1 = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir, maxFiles: 2, now: 100_000 }).path
  fs.utimesSync(p1, 10, 10)
  const p2 = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir, maxFiles: 2, now: 100_000 }).path
  fs.utimesSync(p2, 20, 20)
  const p3 = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_B }, { dir, maxFiles: 2, now: 100_000 }).path
  assert.ok(!fs.existsSync(p1), "oldest paste p1 should be evicted when maxFiles=2 is exceeded")
  assert.ok(fs.existsSync(p2))
  assert.ok(fs.existsSync(p3))

  // Byte quota: allow only 2 * PNG.length bytes total, so a third PNG evicts p2.
  const p4 = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_B }, { dir, maxBytes: PNG.length * 2, now: 100_000 }).path
  assert.ok(!fs.existsSync(p2), "oldest remaining paste p2 should be evicted when maxBytes is exceeded")
  assert.ok(fs.existsSync(p3))
  assert.ok(fs.existsSync(p4))

  // Refuses when the incoming image alone exceeds maxBytes.
  const overQuota = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_B }, { dir, maxBytes: PNG.length - 1 })
  assert.match(overQuota.error, /quota/i)
})

test("cleanupPasteSession removes only the closed terminal's session directory", (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const a = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_A }, { dir }).path
  const b = saveTerminalPaste({ base64: PNG.toString("base64"), sessionId: SESSION_B }, { dir }).path
  assert.ok(fs.existsSync(a))
  assert.ok(fs.existsSync(b))

  const res = cleanupPasteSession({ sessionId: SESSION_A }, { dir })
  assert.strictEqual(res.removed, true)
  assert.ok(!fs.existsSync(a))
  assert.ok(!fs.existsSync(path.join(dir, SESSION_A)))
  assert.ok(fs.existsSync(b))

  // Rejects invalid session ids without touching remaining sessions.
  assert.ok(cleanupPasteSession({ sessionId: "../escape" }, { dir }).error)
  assert.ok(fs.existsSync(b))
})

test("the default directory is per-user under the OS temp dir", (t) => {
  const prev = process.env.OYREN_TERMINAL_PASTE_DIR
  delete process.env.OYREN_TERMINAL_PASTE_DIR
  t.after(() => { if (prev === undefined) delete process.env.OYREN_TERMINAL_PASTE_DIR; else process.env.OYREN_TERMINAL_PASTE_DIR = prev })
  const { defaultPasteDir } = require("./terminalPaste")
  assert.strictEqual(defaultPasteDir(), path.join(os.tmpdir(), `oyren-terminal-pastes-${os.userInfo().username}`))
  process.env.OYREN_TERMINAL_PASTE_DIR = "/somewhere/else"
  assert.strictEqual(defaultPasteDir(), "/somewhere/else")
})

test("registerTerminalPaste wires both paste and session-cleanup commands", async (t) => {
  const dir = path.join(tmpRoot(t), "pastes")
  const registered = {}
  const fakeVscode = { commands: { registerCommand: (id, fn) => { registered[id] = fn; return { dispose() {} } } } }
  const context = { subscriptions: [] }
  registerTerminalPaste(context, fakeVscode, { dir })
  assert.strictEqual(PASTE_IMAGE_COMMAND, "oyren.terminal.pasteImage")
  assert.strictEqual(CLEANUP_PASTE_SESSION_COMMAND, "oyren.terminal.cleanupPasteSession")
  assert.strictEqual(typeof registered[PASTE_IMAGE_COMMAND], "function")
  assert.strictEqual(typeof registered[CLEANUP_PASTE_SESSION_COMMAND], "function")
  const res = await registered[PASTE_IMAGE_COMMAND]({ base64: PNG.toString("base64"), mime: "image/png", sessionId: SESSION_A })
  assert.strictEqual(path.dirname(res.path), path.join(dir, SESSION_A))
  const clean = await registered[CLEANUP_PASTE_SESSION_COMMAND]({ sessionId: SESSION_A })
  assert.strictEqual(clean.removed, true)
  assert.ok(!fs.existsSync(res.path))
})

test("extension.js registers the paste command on activation", () => {
  // activate() pulls in the whole chat stack; checking the wiring statically keeps this test
  // free of a fake for every chat/lm API.
  const src = fs.readFileSync(path.join(__dirname, "extension.js"), "utf8")
  assert.match(src, /require\("\.\/terminalPaste"\)/)
  assert.match(src, /registerTerminalPaste\(context, vscode\)/)
})

