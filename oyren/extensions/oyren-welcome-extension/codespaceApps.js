// The apps of a Codespace, as its dock shows them: a mirror of the hosted registry in
// oyren-ai-codespace (mirrored from dev 84236647, 2026-11-27). Keep it in step with these files;
// codespaceApps.test.js pins the mirror and, given OYREN_CODESPACE_REPO, diffs it against them:
//   workbenchViews.ts      WORKBENCH_VIEWS (the dock, in order), STREAM_WINDOW_VIEWS (windows that
//                          exist only once a command opens them)
//   WorkbenchAppIcons.tsx  WORKBENCH_LABELS (one name per app, everywhere)
//   info/appInfo.ts        APP_INFO (the blurbs below shorten its General pages)
//   icons/tiles.tsx and icons/brandPaths.ts  the tiles (tiles.js, brandMarks.js)
// Home is chrome rather than an app, and "fleet" now opens Chat, so neither is listed.
//
// The editor cannot open these windows itself (it is a window inside the Codespace, with no channel
// to the dock), so the page shows them as a map of the Codespace, not as buttons.
const { TILES } = require("./tiles")

const WORKBENCH = "hosted/src/components/workspaces/workspace-detail/containers/workbench"
const HOSTED_SOURCES = Object.freeze({
  views: "hosted/packages/chat/src/components/workspaces/workspace-detail/containers/workbench/workbenchViews.ts",
  labels: `${WORKBENCH}/WorkbenchAppIcons.tsx`,
  info: `${WORKBENCH}/info/appInfo.ts`,
  tiles: `${WORKBENCH}/icons/tiles.tsx`,
  brandPaths: `${WORKBENCH}/icons/brandPaths.ts`,
})

const app = (id, label, opened, blurb) => Object.freeze({ id, label, opened, blurb, tile: TILES[id] })

const CODESPACE_APPS = Object.freeze([
  app("zed", "Zed", "dock",
    "A native editor on this machine, streamed as pixels. One editor runs at a time, so opening Zed switches from VS Code."),
  app("vscode", "VS Code", "dock",
    "openvscode-server on this machine, drawn in your browser. Extensions install here and survive a reload."),
  app("terminal", "Terminal", "dock",
    "This machine's shell, in the tmux session the launch agent runs in. Click a link to open it in the Browser."),
  app("chat", "My Codespace", "dock",
    "A coding agent in this machine's files, with your sessions, your agents' questions and schedules beside it."),
  app("deepseek", "DeepSeek", "dock",
    "The DeepSeek Harness, baked into the machine and started the first time you open it."),
  app("browser", "Browser", "dock",
    "Chromium on the machine itself: localhost here is this Codespace, so agent logins and your dev server work."),
  app("docs", "Docs", "dock",
    "Step-by-step Codespace guides to keep beside your agent or editor."),
  app("slides", "Slides", "command",
    "Slidev decks saved in this Codespace, with a preview of the running deck."),
  app("sheets", "Sheets", "command",
    "LibreOffice Calc on the Codespace desktop. `oyren sheets file.xlsx` in the Codespace Terminal opens a file."),
  app("files", "Files", "command",
    "A file manager (pcmanfm) opened at /workspace. `oyren files` in the Codespace Terminal opens it too."),
])

module.exports = { CODESPACE_APPS, HOSTED_SOURCES }
