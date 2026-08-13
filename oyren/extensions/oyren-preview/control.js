const http = require("http");

/**
 * Thin client for the sandbox-runtime control API (same-box HTTP, token-gated).
 * `origin` in the route/list response is new in the composer runtime and doubles as the
 * port-proxy capability probe — an absent origin means an old runtime with no port proxy.
 */
function controlPost(action, body) {
  return new Promise((resolve) => {
    const port = Number(process.env.PORT || 8080);
    const token = process.env.CONTROL_TOKEN || "";
    if (!token) return resolve(null);
    const payload = JSON.stringify(body || {});
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/_oyren/control/${action}`,
        timeout: 2000,
        headers: {
          "content-type": "application/json",
          "x-oyren-control-token": token,
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end(payload);
  });
}

async function fetchSession() {
  const parsed = await controlPost("route/list", {});
  return {
    routes: parsed && Array.isArray(parsed.routes) ? parsed.routes : [],
    origin: parsed && typeof parsed.origin === "string" ? parsed.origin : "",
  };
}

module.exports = { controlPost, fetchSession };
