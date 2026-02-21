// src/api.mjs - Web API server + SSE push + static UI serving

import { createServer } from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { log, emit, getRecentLogs, subscribe } from "./logger.mjs";
import { channelToJSON, addKey, removeKey } from "./channel.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let uiHtml = null;

function getUiHtml() {
  if (!uiHtml) {
    try {
      uiHtml = readFileSync(resolve(__dirname, "ui", "index.html"), "utf-8");
    } catch {
      uiHtml = "<h1>AI-Tunnel: UI file not found</h1>";
    }
  }
  return uiHtml;
}

function unauthorized(res) {
  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": 'Bearer realm="ai-tunnel"',
  });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

function checkAuth(req, url, uiAuthToken) {
  if (!uiAuthToken) return true;

  // 1) Authorization header (recommended)
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m && m[1] === uiAuthToken) return true;

  // 2) Query param token (needed for EventSource which can't set headers)
  const qp = url.searchParams.get("token");
  if (qp && qp === uiAuthToken) return true;

  return false;
}

/**
 * Create the API + UI server.
 */
export function createApiServer(router, opts) {
  const uiAuthToken = opts.uiAuthToken || null;

  const server = createServer(async (req, res) => {
    // CORS: keep permissive for local UI; if you expose publicly, put it behind a reverse proxy.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Protect API if token configured
    // Note: We intentionally allow UI HTML to be served without auth, but API requires token.
    if (path.startsWith("/api/") && !checkAuth(req, url, uiAuthToken)) {
      return unauthorized(res);
    }

    try {
      // ─── API Routes ────────────────────────────
      if (path === "/api/status" && req.method === "GET") {
        return handleStatus(router, res);
      }
      if (path === "/api/channels" && req.method === "GET") {
        return handleListChannels(router, res);
      }
      if (path === "/api/stats" && req.method === "GET") {
        return handleStats(router, res);
      }
      if (path === "/api/logs" && req.method === "GET") {
        return handleLogsSSE(res);
      }
      if (path === "/api/logs/recent" && req.method === "GET") {
        return json(res, 200, getRecentLogs(50));
      }
      if (path === "/api/config/reload" && req.method === "POST") {
        emit("config_reload_request", {});
        return json(res, 200, { ok: true, message: "Reload requested" });
      }

      // POST /api/channels/:name/toggle
      const toggleMatch = path.match(/^\/api\/channels\/([^/]+)\/toggle$/);
      if (toggleMatch && req.method === "POST") {
        return handleToggle(router, decodeURIComponent(toggleMatch[1]), res);
      }

      // POST /api/channels/:name/keys
      const addKeyMatch = path.match(/^\/api\/channels\/([^/]+)\/keys$/);
      if (addKeyMatch && req.method === "POST") {
        return await handleAddKey(router, decodeURIComponent(addKeyMatch[1]), req, res);
      }

      // DELETE /api/channels/:name/keys/:index
      const delKeyMatch = path.match(/^\/api\/channels\/([^/]+)\/keys\/(\d+)$/);
      if (delKeyMatch && req.method === "DELETE") {
        return handleDeleteKey(router, decodeURIComponent(delKeyMatch[1]), parseInt(delKeyMatch[2]), res);
      }

      // ─── UI ────────────────────────────────────
      if (path === "/" || path === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(getUiHtml());
      }

      // 404
      json(res, 404, { error: "Not found" });
    } catch (e) {
      log("error", "API", "Handler error: %s", e.message);
      if (!res.headersSent) {
        json(res, 500, { error: "Internal server error" });
      }
    }
  });

  server.listen(opts.port, opts.host, () => {
    log("info", "UI", "Web UI available at http://%s:%d", opts.host, opts.port);
    if (uiAuthToken) {
      log("warn", "UI", "UI/API auth is enabled (Bearer token required)");
    }
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log("error", "UI", "Port %d already in use", opts.port);
    } else {
      log("error", "UI", "Server error: %s", e.message);
    }
  });

  return server;
}

// ─── Handlers ────────────────────────────────────────

function handleStatus(router, res) {
  const channels = router.getAllChannels();
  const healthy = channels.filter((c) => c.health === "healthy").length;
  json(res, 200, {
    status: "running",
    uptime: Math.floor(process.uptime()),
    channels: { healthy, total: channels.length },
    version: "2.0.0",
  });
}

function handleListChannels(router, res) {
  json(res, 200, router.getAllChannels().map(channelToJSON));
}

function handleStats(router, res) {
  const channels = router.getAllChannels();
  let totalReq = 0,
    totalOk = 0,
    totalFail = 0;
  const perChannel = {};

  for (const ch of channels) {
    const s = ch.stats;
    totalReq += s.totalRequests;
    totalOk += s.successCount;
    totalFail += s.failCount;
    perChannel[ch.name] = {
      requests: s.totalRequests,
      success: s.successCount,
      fail: s.failCount,
      successRate:
        s.totalRequests > 0
          ? ((s.successCount / s.totalRequests) * 100).toFixed(1) + "%"
          : "N/A",
    };
  }

  json(res, 200, {
    totalRequests: totalReq,
    totalSuccess: totalOk,
    totalFail,
    channels: perChannel,
  });
}

function handleToggle(router, name, res) {
  const ch = router.getChannel(name);
  if (!ch) return json(res, 404, { error: `Channel '${name}' not found` });
  ch.enabled = !ch.enabled;
  log("info", ch.name, "Channel %s", ch.enabled ? "enabled" : "disabled");
  emit("channel_toggle", { channel: ch.name, enabled: ch.enabled });
  json(res, 200, channelToJSON(ch));
}

async function handleAddKey(router, name, req, res) {
  const ch = router.getChannel(name);
  if (!ch) return json(res, 404, { error: `Channel '${name}' not found` });

  const body = await readBody(req);
  try {
    const { key } = JSON.parse(body);
    if (!key) return json(res, 400, { error: "Missing 'key' field" });
    addKey(ch, key);
    json(res, 200, channelToJSON(ch));
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
  }
}

function handleDeleteKey(router, name, keyIndex, res) {
  const ch = router.getChannel(name);
  if (!ch) return json(res, 404, { error: `Channel '${name}' not found` });
  if (!removeKey(ch, keyIndex))
    return json(res, 400, { error: `Invalid key index: ${keyIndex}` });
  json(res, 200, channelToJSON(ch));
}

function handleLogsSSE(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const recent = getRecentLogs(30);
  for (const entry of recent) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const unsub = subscribe("*", (_type, data) => {
    try {
      res.write(`data: ${JSON.stringify({ type: _type, ...data })}\n\n`);
    } catch {
      /* client gone */
    }
  });

  const hb = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      /* ignore */
    }
  }, 15000);

  const cleanup = () => {
    unsub();
    clearInterval(hb);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
}

// ─── Helpers ─────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((r) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => r(Buffer.concat(chunks).toString()));
    req.on("error", () => r(""));
  });
}
