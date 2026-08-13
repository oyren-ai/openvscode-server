const vscode = require("vscode");

/**
 * Why not always http://localhost:<port>? The Simple Browser's iframe renders in the END USER's
 * browser, so "localhost" there means the user's own machine — and when the editor is embedded in
 * public https://oyren.ai, Chromium's Local Network Access policy blocks the public page from
 * reaching localhost at all. The session origin serves both the editor iframe and the gateway
 * routes, so a same-origin URL embeds without the block.
 *
 * Port-proxy URL contract: <origin>/_oyren/port/<SESSION_TOKEN>/<port>/<rest> — the token is
 * mandatory; the proxy is token-gated exactly like /_oyren/ide.
 */
function isLocalhostAuthority(authority) {
  const a = String(authority || "").toLowerCase();
  const host = a.startsWith("[") ? a.slice(1, a.indexOf("]")) : a.split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

async function previewUrl(port, origin, log) {
  const localUrl = `http://localhost:${port}`;
  if (!origin) {
    log(`no session origin from control API — old runtime without port proxy, using ${localUrl}`);
    return localUrl;
  }
  try {
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(localUrl));
    if (!isLocalhostAuthority(external.authority)) return external.toString(true);
    log(`asExternalUri stayed localhost-ish (${external.authority}) — building port-proxy URL`);
  } catch (err) {
    log(`asExternalUri failed (${(err && err.message) || err}) — building port-proxy URL`);
  }
  const token = process.env.SESSION_TOKEN || "";
  if (!token) {
    log(`SESSION_TOKEN unset — cannot build token-gated port-proxy URL, using ${localUrl}`);
    return localUrl;
  }
  return `${origin.replace(/\/+$/, "")}/_oyren/port/${token}/${port}/`;
}

module.exports = { previewUrl };
