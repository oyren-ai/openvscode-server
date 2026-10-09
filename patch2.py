import os

path = 'oyren/extensions/oyren-agent-extension/extension.js'
with open(path, 'r') as f:
    content = f.read()

content = content.replace(
    'const dir = process.env.OYREN_TERMINAL_PASTE_DIR || path.join(os.tmpdir(), "oyren-terminal-pastes")',
    'const userInfo = os.userInfo()\n      const dir = process.env.OYREN_TERMINAL_PASTE_DIR || path.join(os.tmpdir(), "oyren-terminal-pastes-" + userInfo.username)'
)

content = content.replace(
    'fs.mkdirSync(dir, { recursive: true })',
    'fs.mkdirSync(dir, { recursive: true, mode: 0o700 })'
)

content = content.replace(
    'fs.writeFileSync(dest, buf)',
    'fs.writeFileSync(dest, buf, { mode: 0o600 })'
)

with open(path, 'w') as f:
    f.write(content)
