import os

path = 'oyren/extensions/oyren-agent-extension/extension.js'
with open(path, 'r') as f:
    content = f.read()

old_code = """      const MAX_BYTES = 10 * 1024 * 1024
      const buf = Buffer.from(args.base64, 'base64')
      if (buf.length > MAX_BYTES) return
      
      const EXT_BY_MIME = {
        "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
        "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg"
      }
      const ext = EXT_BY_MIME[String(args.mime).toLowerCase()] || "png"
      const name = `paste-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`
      const dest = path.join(dir, name)
      
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.writeFileSync(dest, buf, { mode: 0o600 })
      
      const term = vscode.window.activeTerminal
      if (term) {
        term.sendText(dest + " ", false)
      }"""

new_code = """      const MAX_BYTES = 10 * 1024 * 1024;
      // Rough base64 length check (4 chars = 3 bytes)
      if (args.base64.length > (MAX_BYTES * 4 / 3) + 1000) return;
      const buf = Buffer.from(args.base64, 'base64');
      if (buf.length > MAX_BYTES) return;
      
      const EXT_BY_MIME = {
        "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
        "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp"
      }
      // Exclude svg
      const ext = EXT_BY_MIME[String(args.mime).toLowerCase()];
      if (!ext) return;
      
      const name = `paste-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      const dest = path.join(dir, name);
      
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(dest, buf, { mode: 0o600 });
      return dest;"""

content = content.replace(old_code, new_code)
with open(path, 'w') as f:
    f.write(content)
