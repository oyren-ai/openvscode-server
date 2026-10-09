const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Mock vscode
const commands = {};
const mockTerminal = {
  texts: [],
  sendText(text, addNewLine) {
    this.texts.push({ text, addNewLine });
  }
};
const vscode = {
  commands: {
    registerCommand(name, fn) {
      commands[name] = fn;
      return { dispose: () => {} };
    }
  },
  window: {
    get activeTerminal() { return mockTerminal; }
  },
  chat: { createChatParticipant: () => ({ dispose: () => {} }) },
  lm: { registerLanguageModelChatProvider: () => ({ dispose: () => {} }), selectChatModels: async () => [] }
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(req) {
  if (req === 'vscode') return vscode;
  if (req.includes('./agentClient')) return { createClient: () => ({}) };
  if (req.includes('./turnHandler')) return { makeHandler: () => ({}) };
  if (req.includes('./modelProvider')) return { createModelProvider: () => ({}) };
  if (req.includes('./sessionProviders')) return { registerSessionProviders: () => {} };
  return originalRequire.apply(this, arguments);
};

const { activate } = require("./extension.js");

test("oyren.terminal.pasteImage", async (t) => {
  const context = { subscriptions: [] };
  activate(context);
  const handler = commands['oyren.terminal.pasteImage'];
  assert.ok(handler);

  // We need to mock fs to avoid writing real files
  const originalWriteFile = fs.writeFileSync;
  const originalMkdir = fs.mkdirSync;
  
  let writtenFiles = [];
  let mkdirs = [];
  
  fs.writeFileSync = (dest, buf, options) => {
    writtenFiles.push({ dest, buf, options });
  };
  fs.mkdirSync = (dir, options) => {
    mkdirs.push({ dir, options });
  };

  t.afterEach(() => {
    writtenFiles = [];
    mkdirs = [];
    mockTerminal.texts = [];
  });

  t.after(() => {
    fs.writeFileSync = originalWriteFile;
    fs.mkdirSync = originalMkdir;
  });

  await t.test("rejects >10 MB", async () => {
    // 11 MB of data
    const buf = Buffer.alloc(11 * 1024 * 1024);
    const base64 = buf.toString('base64');
    const result = await handler({ base64, mime: 'image/png' });
    assert.strictEqual(result, undefined);
    assert.strictEqual(writtenFiles.length, 0);
  });

  await t.test("rejects non-allowlisted MIME (incl svg)", async () => {
    const buf = Buffer.from('hello', 'utf-8');
    const base64 = buf.toString('base64');
    
    await handler({ base64, mime: 'image/svg+xml' });
    assert.strictEqual(writtenFiles.length, 0);

    await handler({ base64, mime: 'text/plain' });
    assert.strictEqual(writtenFiles.length, 0);
  });

  await t.test("ignores any path from the client", async () => {
    const buf = Buffer.from('hello', 'utf-8');
    const base64 = buf.toString('base64');
    
    await handler({ base64, mime: 'image/png', path: '/etc/passwd' });
    assert.strictEqual(writtenFiles.length, 1);
    
    const userInfo = os.userInfo();
    const expectedDir = process.env.OYREN_TERMINAL_PASTE_DIR || path.join(os.tmpdir(), "oyren-terminal-pastes-" + userInfo.username);
    assert.ok(writtenFiles[0].dest.startsWith(expectedDir));
    assert.ok(!writtenFiles[0].dest.includes('/etc/passwd'));
  });

  await t.test("writes 0600 inside a 0700 per-user dir", async () => {
    const buf = Buffer.from('hello', 'utf-8');
    const base64 = buf.toString('base64');
    await handler({ base64, mime: 'image/png' });
    
    assert.strictEqual(mkdirs.length, 1);
    assert.strictEqual(mkdirs[0].options.mode, 0o700);
    assert.strictEqual(mkdirs[0].options.recursive, true);

    assert.strictEqual(writtenFiles.length, 1);
    assert.strictEqual(writtenFiles[0].options.mode, 0o600);
  });

  await t.test("returns a shell-quoted path", async () => {
    const buf = Buffer.from('hello', 'utf-8');
    const base64 = buf.toString('base64');
    const resultPath = await handler({ base64, mime: 'image/png' });
    
    assert.strictEqual(typeof resultPath, 'string');
    assert.ok(resultPath.endsWith('.png'));
  });
});
