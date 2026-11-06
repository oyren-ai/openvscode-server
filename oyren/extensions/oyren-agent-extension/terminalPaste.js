// Terminal image paste, extension-host half (runs in the sandbox, next to the shell and the agents).
//
// The patched workbench (terminalContrib/clipboard, see oyren/docs) reads an image off the BROWSER's
// clipboard on paste and calls PASTE_IMAGE_COMMAND with { base64, mime }. We write it into a private
// per-user directory and return { path }; the workbench types that path into the terminal, the same
// way a file dropped onto the terminal arrives. Claude Code (and other CLI agents) attach an image
// whose path is pasted into their prompt — the sandbox has no access to the user's own clipboard,
// so this is the only way a screenshot reaches them.
//
// Everything from the client is untrusted: only the bytes are used, the type comes from the magic
// bytes (allowlist, no SVG), the name is random, and the directory is ours alone (0700, not a
// symlink, owned by us). Failures come back as { error } so the workbench can say why.
const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")

const PASTE_IMAGE_COMMAND = "oyren.terminal.pasteImage"
const MAX_PASTE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"])

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
 * @param {{ base64?: unknown, mime?: unknown }} args from the workbench (untrusted)
 * @param {{ dir?: string, uid?: number }} [opts] tests inject both
 * @returns {{ path: string } | { error: string }}
 */
function saveTerminalPaste(args, opts = {}) {
  if (!args || typeof args !== "object" || typeof args.base64 !== "string" || args.base64.length === 0) {
    return { error: "no image data" }
  }
  if (args.mime !== undefined && !ALLOWED_MIMES.has(String(args.mime).toLowerCase())) {
    return { error: `unsupported image type ${String(args.mime)}` }
  }
  // 4 base64 chars per 3 bytes: refuse oversized payloads before allocating the decoded buffer.
  if (args.base64.length > Math.ceil(MAX_PASTE_BYTES / 3) * 4 + 4) {
    return { error: "image is larger than 10 MB" }
  }
  const buf = Buffer.from(args.base64, "base64")
  if (buf.length > MAX_PASTE_BYTES) return { error: "image is larger than 10 MB" }
  const ext = sniffImageType(buf)
  if (!ext) return { error: "not a PNG, JPEG, GIF, WebP or BMP image" }

  const dir = opts.dir || defaultPasteDir()
  const uid = opts.uid !== undefined ? opts.uid : os.userInfo().uid
  const dirError = ensurePrivateDir(dir, uid)
  if (dirError) return { error: dirError }

  const dest = path.join(dir, `paste-${crypto.randomBytes(16).toString("hex")}.${ext}`)
  try {
    fs.writeFileSync(dest, buf, { mode: 0o600, flag: "wx" })
  } catch (err) {
    return { error: `cannot write the image: ${err.message}` }
  }
  return { path: dest }
}

function registerTerminalPaste(context, vscode, opts) {
  context.subscriptions.push(vscode.commands.registerCommand(PASTE_IMAGE_COMMAND, async (args) => {
    const res = saveTerminalPaste(args, opts)
    if (res.error) console.error(`oyren-agent: terminal image paste failed: ${res.error}`)
    return res
  }))
}

module.exports = { PASTE_IMAGE_COMMAND, MAX_PASTE_BYTES, sniffImageType, defaultPasteDir, saveTerminalPaste, registerTerminalPaste }
