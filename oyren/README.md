# oyren/ — the Oyren Editor's fast-changing layer

This fork ships the Oyren Editor in two layers:

1. **Server builds** (slow, ~50–70 min CI): the patched openvscode-server workbench, built by
   `.github/workflows/build-oyren-release.yml` on every `openvscode-server-v*-oyren.*` tag push
   and published as a versioned GitHub release. The patches live as commits on `oyren/1.109`
   (drop `defaultChatAgent`, guard its dereferences, list contributed chat session types in the
   agent-type picker with their own icons, hide the redundant "Local" row, brand the empty state).
2. **This directory** (fast, ~seconds): everything a session can swap at boot without a new
   snapshot or server build —
   - `extensions/` — first-party extensions installed as built-ins:
     `oyren-agent-extension` (the Chat view's default participant + one chat session type per
     CLI agent; off unless `oyren.agentChat.enabled` is true, since 2026-11-27),
     `oyren-welcome-extension` (the Codespace welcome page in the middle: this Codespace's facts
     and every app in it with its icon; its start sequence also hides the built-in Chat view and
     opens Claude Code, else Codex, in the secondary side bar), and `oyren-preview`
     (a command + status bar item that opens the built-in Simple Browser pointed at
     `http://localhost:<port>` — a mini in-editor preview of the session's own dev server, no
     public route needed).
   - `settings/` — seeded editor settings (`machine-settings.json` every boot,
     `user-settings.json` once) and `product.overrides.json`, the branding merged into the
     server's `product.json`.
   - `scripts/merge-product.js` — applies those overrides (null = delete the key).
   - `SERVER_VERSION` — which server build sessions should run. Bumping it makes every session
     download and swap the server at next editor start: fork builds also ship without a bake.

## Shipping a change

```
oyren/scripts/pack-editor-extras.sh
```

packs this directory into `oyren-editor-extras.tar.gz` and uploads it to the rolling
`editor-extras` prerelease. Droplet sessions run `oyren-editor-update --boot` (systemd
`ExecStartPre` of `oyren-editor.service`) which fetches that tarball, swaps the server if
`server-version` changed, overlays the extensions, and re-seeds settings. Inside a live session,
plain `oyren-editor-update` does the same and restarts the editor. The snapshot bake downloads
the same tarball for its offline fallback, so the release is the single source of truth.

The boot plumbing (`oyren-editor-update`, the server-swap helper, systemd units, bake scripts)
lives in the private `oyren-ai-composer` repo, which owns the droplet image.

### Publishing a change: runbook and rollback

Publishing is a production release. Every Codespace, on dev and production, installs the new layer
at its next editor start, and the boot overlay applies the asset without any hash check. Only the
bytes a snapshot bake installs are pinned: `EDITOR_EXTRAS_SHA256` in composer's `deploy/versions.env`,
read from the branch the bake runs on. Dev bakes run on composer `dev`. Only a bake on composer `main`
may register images with production. So the pin must match the asset on both branches. A bake on a
branch whose pin does not match fails closed at the editor-extras hash check; it never installs other
bytes. Bakes are only dispatched by hand (`bake-snapshots.yml` has no schedule), so dispatch none
between steps 5 and 7.

1. Merge the change into `oyren/1.109`.
2. Keep the asset that is live now, in a directory of its own (`<keep>`):
   `gh release download editor-extras --repo oyren-ai/openvscode-server -p oyren-editor-extras.tar.gz -D <keep>`.
   Note its sha256, K.
3. From a clean checkout of the merged `oyren/1.109`, pack into another directory (`<new>`):
   `OYREN_CODESPACE_REPO=<oyren-ai-codespace checkout at origin/dev> oyren/scripts/pack-editor-extras.sh --pack-only <new>`.
   Check that both suites passed. It prints the new sha256, S.
4. Open the composer PRs that set `EDITOR_EXTRAS_SHA256=S`:
   - one into `dev`;
   - its way to `main`: the next composer release PR (`release/composer-<dev sha>`) once the dev PR is
     in, or, if dev is not ready to release, a PR into `main` that changes only that line.

   Check that no bake is running or queued:
   `gh run list --repo oyren-ai/oyren-ai-composer --workflow bake-snapshots.yml --status in_progress`
   (and again with `--status queued`).
5. Upload exactly those bytes: `oyren/scripts/pack-editor-extras.sh --upload <new>/oyren-editor-extras.tar.gz S`.
   It refuses a file whose sha256 is not S. Then
   `gh api repos/oyren-ai/openvscode-server/releases/tags/editor-extras --jq '.assets[] | select(.name == "oyren-editor-extras.tar.gz") | .digest'`
   must print `sha256:S`.
6. Merge the composer `dev` PR. Dev bakes pass again.
7. Merge the change into composer `main`. Production bakes pass again.
8. Check on oyren.dev: a new Codespace starts on the new layer. A running one keeps its editor until
   its next editor start, or until `oyren-editor-update` runs in its terminal.

**Rollback.** It has to stick. This script packs whatever `oyren/1.109` holds, so while the change
stays merged there, the next routine publish from that branch ships it again to every Codespace.

1. Upload the kept asset: `oyren/scripts/pack-editor-extras.sh --upload <keep>/oyren-editor-extras.tar.gz K`.
   New editor starts get the previous layer.
2. Revert the change on `oyren/1.109` (a revert PR). Publish nothing from that branch until the
   revert is merged.
3. Put the pin back to K on composer `dev` (revert the dev PR), and on `main` if step 7 happened (a PR
   into `main` that changes only that line). As on the way up, a bake on a branch whose pin does not
   match the asset fails closed until its PR is merged.

## Notes

- `anthropic.claude-code` (from Open VSX) is installed at bake time, per-user, and was verified
  at v2.1.221 to contribute no `chatSessions`. If a future version starts contributing one, a
  "Claude" row reappears in the agent-type dropdown — disable with `INSTALL_CLAUDE_EXTENSION=0`
  at bake, or pin the extension version.
- `openai.chatgpt` (Codex, from Open VSX) is installed at bake time the same way, but — unlike
  Claude — it DOES contribute a `chatSessions` entry (`type: "openai-codex", name: "Codex"`,
  verified at v26.5803.61601), so its own native "Codex" row and chat panel appear in the
  agent-type dropdown alongside Oyren's existing synthetic `codex-cli` entry (the ACP-driven
  headless CLI session type). The two are separate integrations with separate auth flows — this
  is a known, accepted duplication for now, not a bug; disable with `INSTALL_CODEX_EXTENSION=0`
  at bake if the duplicate row becomes a problem before it's reconciled.
- `claude-code` has no chat-session row on purpose: it runs launch-only (SDK engine, no ACP
  side-engine recipe), and a dead dropdown row is worse than none.
- The other official companions — `qwenlm.qwen-code-vscode-ide-companion` and
  `google.gemini-cli-vscode-ide-companion` — are deliberately NOT baked or bundled: they're
  installable from the editor's own marketplace (Open VSX) inside a session, on demand (decision
  2026-08-12). Verified at 0.21.10/0.20.0: neither contributes `chatSessions`, so no dropdown row
  either way — Qwen brings its own sidebar chat webview, Gemini's pairs with the terminal CLI
  (context/diffing only). The synthetic `qwen-code`/`gemini-cli` rows therefore remain the only
  native-chat, sandbox-credentialed integration. An in-session install persists for that
  server's life only; fresh sessions start without it unless a bake later adds it per-user.
  (`google.geminicodeassist` also exists on Open VSX but is proprietary-licensed and 178 MB —
  never bundle it into editor-extras; marketplace install is the only sanctioned path.)
- `npm-wrapper/` is the `@oyren.ai/openvscode-server` npm package: a thin postinstall wrapper
  that downloads the matching server release tarball.
- **Display language**: "Configure Display Language" (Command Palette) and installing a
  marketplace language pack (`open-vsx.org`, unmodified from upstream — the
  `MS-CEINTL.vscode-language-pack-*` extensions it looks for are there) both work end-to-end.
  Core workbench strings (menus, settings, the Command Palette itself) will not actually
  translate, though — `product.json` has never set `nlsCoreBaseUrl`, the field
  `src/vs/server/node/webClientServer.ts` needs to serve a translated core NLS bundle instead of
  the English fallback. That field is a Microsoft-internal-CDN feature upstream openvscode-server
  never had either, not something this fork disabled — standing it up means hosting a translated
  bundle source ourselves, not a code fix. Extension-contributed strings (the language pack's own
  point) translate correctly regardless.
