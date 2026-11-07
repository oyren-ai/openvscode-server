// Terminal image paste, extension-host half (runs in the sandbox, next to the shell and the agents).
//
// The patched workbench (src/vs/workbench/contrib/terminalContrib/clipboard/) reads an image off the
// BROWSER's clipboard on paste and calls PASTE_IMAGE_COMMAND with { base64, mime, sessionId }. We
// write it into a 0700 per-session subdirectory under a 0700 per-user root directory and return
// { path }; the workbench types that path into the terminal, the same way a file dropped onto the
// terminal arrives. Claude Code (and other CLI agents) attach an image whose path is pasted into
// their prompt — the sandbox has no access to the user's own clipboard, so this is the only way a
// screenshot reaches them.
//
// Threat model & mitigations:
// - Every process in a Codespace sandbox (including the terminal shell and Claude Code that read the
//   pasted file path) runs as the same Unix UID, so POSIX 0700/0600 modes isolate against other OS
//   users, not against same-UID processes inside the same sandbox.
// - To bound how long a screenshot lingers on disk and prevent temporary storage exhaustion:
//   1. Each terminal instance uses an unguessable 128-bit hex `sessionId` subdirectory (`0700`) and
//      each paste uses a 128-bit random filename (`paste-<32-hex>.<ext>`, `0600`, `wx`).
//   2. Closing the terminal invokes CLEANUP_PASTE_SESSION_COMMAND to delete that terminal session's
//      subdirectory immediately.
//   3. Every paste sweeps expired files older than PASTE_TTL_MS (1 hour default), schedules an
//      unref'd timer to delete the file after PASTE_TTL_MS, and enforces an aggregate per-user
//      directory quota (MAX_PASTE_FILES = 32 files, MAX_PASTE_DIR_BYTES = 50 MiB) by evicting the
//      oldest pasted files first.
// - Everything from the client is untrusted: only the bytes are used, the type comes from magic
//   bytes (allowlist, no SVG), `sessionId` is restricted to 32-64 lowercase hex chars, and both the
//   root and session directories are verified with lstatSync (0700, not a symlink, owned by us).
const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")

const PASTE_IMAGE_COMMAND = "oyren.terminal.pasteImage"
const CLEANUP_PASTE_SESSION_COMMAND = "oyren.terminal.cleanupPasteSession"

// Keep MAX_PASTE_BYTES and sniffImageType in sync with TERMINAL_PASTE_IMAGE_MAX_BYTES and
// sniffImageMime in src/vs/workbench/contrib/terminalContrib/clipboard/common/terminalImagePaste.ts.
const MAX_PASTE_BYTES = 10 * 1024 * 1024
const MAX_PASTE_DIR_BYTES = 50 * 1024 * 1024
const MAX_PASTE_FILES = 32
const PASTE_TTL_MS = 60 * 60 * 1000
const ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"])
const SESSION_ID_RE = /^[0-9a-f]{32,64}$/

function sniffImageType(buf) {
  if (!buf || buf.length < 4) return undefined
  const at = (offset, bytes) => buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b)
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  if (at(0, [0xff, 0xd8, 0xff])) return "jpg"
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "gif" // GIF8
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "webp" // RIFF....WEBP
  if (at(0, [0x42, 0x4d])) return "bmp" // BM
  return undefined
}

function defaultPasteDir() {
  return process.env.OYREN_TERMINAL_PASTE_DIR || path.join(os.tmpdir(), `oyren-terminal-pastes-${os.userInfo().username}`)
}

/** Make sure `dir` is a real directory we own with mode 0700. Returns an error string or undefined. */
function ensurePrivateDir(dir, uid) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (err) {
    if (err.code !== "EEXIST") return `cannot create ${dir}: ${err.message}`
  }
  let st
  try {
    st = fs.lstatSync(dir)
  } catch (err) {
    return `cannot stat ${dir}: ${err.message}`
  }
  if (!st.isDirectory()) return `${dir} is not a directory`
  if (st.uid !== uid) return `${dir} is owned by another user`
  if ((st.mode & 0o777) !== 0o700) {
    try {
      fs.chmodSync(dir, 0o700)
    } catch (err) {
      return `cannot make ${dir} private: ${err.message}`
    }
  }
  return undefined
}

/**
 * Sweep expired paste files (> ttlMs old) and evict oldest files until adding `incomingBytes` fits
 * within `maxFiles` and `maxBytes`. Removes empty session subdirectories along the way.
 */
function prunePasteDir(rootDir, uid, { ttlMs, maxFiles, maxBytes, incomingBytes, now }) {
  if (incomingBytes > maxBytes || maxFiles < 1) {
    return "paste storage quota exceeded"
  }
  const files = []
  let entries = []
  try {
    entries = fs.readdirSync(rootDir)
  } catch {
    return undefined
  }
  for (const name of entries) {
    const entryPath = path.join(rootDir, name)
    let st
    try {
      st = fs.lstatSync(entryPath)
    } catch {
      continue
    }
    if (st.uid !== uid || st.isSymbolicLink()) continue
    if (st.isFile()) {
      if (now - st.mtimeMs >= ttlMs) {
        try { fs.unlinkSync(entryPath) } catch {}
      } else {
        files.push({ filePath: entryPath, parentDir: null, size: st.size, mtimeMs: st.mtimeMs })
      }
      continue
    }
    if (!st.isDirectory() || !SESSION_ID_RE.test(name)) continue
    let subEntries = []
    try {
      subEntries = fs.readdirSync(entryPath)
    } catch {
      continue
    }
    let remainingInSub = 0
    for (const subName of subEntries) {
      const subPath = path.join(entryPath, subName)
      let subSt
      try {
        subSt = fs.lstatSync(subPath)
      } catch {
        continue
      }
      if (subSt.uid !== uid || !subSt.isFile()) continue
      if (now - subSt.mtimeMs >= ttlMs) {
        try { fs.unlinkSync(subPath) } catch {}
      } else {
        remainingInSub++
        files.push({ filePath: subPath, parentDir: entryPath, size: subSt.size, mtimeMs: subSt.mtimeMs })
      }
    }
    if (remainingInSub === 0) {
      try { fs.rmdirSync(entryPath) } catch {}
    }
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.filePath.localeCompare(b.filePath))
  let totalBytes = files.reduce((acc, f) => acc + f.size, 0)
  let count = files.length
  const touchedDirs = new Set()
  for (const f of files) {
    if (count + 1 <= maxFiles && totalBytes + incomingBytes <= maxBytes) break
    try {
      fs.unlinkSync(f.filePath)
      count--
      totalBytes -= f.size
      if (f.parentDir) touchedDirs.add(f.parentDir)
    } catch {}
  }
  for (const d of touchedDirs) {
    try {
      if (fs.readdirSync(d).length === 0) fs.rmdirSync(d)
    } catch {}
  }
  if (count + 1 > maxFiles || totalBytes + incomingBytes > maxBytes) {
    return "paste storage quota exceeded"
  }
  return undefined
}

function scheduleFileExpiry(filePath, sessionDir, ttlMs) {
  if (!(ttlMs > 0)) return
  const timer = setTimeout(() => {
    try { fs.unlinkSync(filePath) } catch {}
    try {
      if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir)
    } catch {}
  }, ttlMs)
  if (typeof timer.unref === "function") timer.unref()
}

/**
 * @param {{ base64?: unknown, mime?: unknown, sessionId?: unknown }} args from the workbench (untrusted)
 * @param {{ dir?: string, uid?: number, ttlMs?: number, maxFiles?: number, maxBytes?: number, now?: number, scheduleCleanup?: boolean }} [opts]
 * @returns {{ path: string } | { error: string }}
 */
function saveTerminalPaste(args, opts = {}) {
  if (!args || typeof args !== "object" || typeof args.base64 !== "string" || args.base64.length === 0) {
    return { error: "no image data" }
  }
  if (args.mime !== undefined && !ALLOWED_MIMES.has(String(args.mime).toLowerCase())) {
    return { error: `unsupported image type ${String(args.mime)}` }
  }
  let sessionId
  if (args.sessionId === undefined) {
    sessionId = crypto.randomBytes(16).toString("hex")
  } else if (typeof args.sessionId === "string" && SESSION_ID_RE.test(args.sessionId)) {
    sessionId = args.sessionId
  } else {
    return { error: "invalid terminal paste session id" }
  }
  // 4 base64 chars per 3 bytes: refuse oversized payloads before allocating the decoded buffer.
  if (args.base64.length > Math.ceil(MAX_PASTE_BYTES / 3) * 4 + 4) {
    return { error: "image is larger than 10 MB" }
  }
  const buf = Buffer.from(args.base64, "base64")
  if (buf.length > MAX_PASTE_BYTES) return { error: "image is larger than 10 MB" }
  const ext = sniffImageType(buf)
  if (!ext) return { error: "not a PNG, JPEG, GIF, WebP or BMP image" }

  const rootDir = opts.dir || defaultPasteDir()
  const uid = opts.uid !== undefined ? opts.uid : os.userInfo().uid
  const rootError = ensurePrivateDir(rootDir, uid)
  if (rootError) return { error: rootError }

  const ttlMs = opts.ttlMs !== undefined ? opts.ttlMs : PASTE_TTL_MS
  const maxFiles = opts.maxFiles !== undefined ? opts.maxFiles : MAX_PASTE_FILES
  const maxBytes = opts.maxBytes !== undefined ? opts.maxBytes : MAX_PASTE_DIR_BYTES
  const now = opts.now !== undefined ? opts.now : Date.now()
  const quotaError = prunePasteDir(rootDir, uid, { ttlMs, maxFiles, maxBytes, incomingBytes: buf.length, now })
  if (quotaError) return { error: quotaError }

  const sessionDir = path.join(rootDir, sessionId)
  const sessionError = ensurePrivateDir(sessionDir, uid)
  if (sessionError) return { error: sessionError }

  const dest = path.join(sessionDir, `paste-${crypto.randomBytes(16).toString("hex")}.${ext}`)
  try {
    fs.writeFileSync(dest, buf, { mode: 0o600, flag: "wx" })
  } catch (err) {
    return { error: `cannot write the image: ${err.message}` }
  }
  if (opts.scheduleCleanup) {
    scheduleFileExpiry(dest, sessionDir, ttlMs)
  }
  return { path: dest }
}

/**
 * Remove all pasted images belonging to a closed terminal's `sessionId`.
 * @param {{ sessionId?: unknown }} args
 * @param {{ dir?: string, uid?: number }} [opts]
 */
function cleanupPasteSession(args, opts = {}) {
  if (!args || typeof args !== "object" || typeof args.sessionId !== "string" || !SESSION_ID_RE.test(args.sessionId)) {
    return { error: "invalid terminal paste session id" }
  }
  const rootDir = opts.dir || defaultPasteDir()
  const uid = opts.uid !== undefined ? opts.uid : os.userInfo().uid
  if (!fs.existsSync(rootDir)) return { removed: false }
  const rootError = ensurePrivateDir(rootDir, uid)
  if (rootError) return { error: rootError }

  const sessionDir = path.join(rootDir, args.sessionId)
  let st
  try {
    st = fs.lstatSync(sessionDir)
  } catch (err) {
    if (err.code === "ENOENT") return { removed: false }
    return { error: `cannot stat ${sessionDir}: ${err.message}` }
  }
  if (!st.isDirectory() || st.uid !== uid) {
    return { error: `${sessionDir} is not a private session directory` }
  }
  try {
    for (const entry of fs.readdirSync(sessionDir)) {
      const child = path.join(sessionDir, entry)
      const childSt = fs.lstatSync(child)
      if (childSt.uid === uid && childSt.isFile()) {
        fs.unlinkSync(child)
      }
    }
    fs.rmdirSync(sessionDir)
  } catch (err) {
    return { error: `cannot remove ${sessionDir}: ${err.message}` }
  }
  return { removed: true }
}

function registerTerminalPaste(context, vscode, opts) {
  const runtimeOpts = { scheduleCleanup: true, ...opts }
  context.subscriptions.push(
    vscode.commands.registerCommand(PASTE_IMAGE_COMMAND, async (args) => {
      const res = saveTerminalPaste(args, runtimeOpts)
      if (res.error) console.error(`oyren-agent: terminal image paste failed: ${res.error}`)
      return res
    }),
    vscode.commands.registerCommand(CLEANUP_PASTE_SESSION_COMMAND, async (args) => {
      return cleanupPasteSession(args, opts)
    }),
  )
}

module.exports = {
  PASTE_IMAGE_COMMAND,
  CLEANUP_PASTE_SESSION_COMMAND,
  MAX_PASTE_BYTES,
  MAX_PASTE_DIR_BYTES,
  MAX_PASTE_FILES,
  PASTE_TTL_MS,
  sniffImageType,
  defaultPasteDir,
  saveTerminalPaste,
  cleanupPasteSession,
  registerTerminalPaste,
}
