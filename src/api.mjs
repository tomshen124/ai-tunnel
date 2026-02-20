// src/api.mjs - Web API server + SSE push + static UI serving

import { createServer } from "http";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
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

/**
 * Create the API + UI server.
 * If opts.token is set, all /api/* requests (except SSE) require
 * Authorization: Bearer <token> header.
 */
export function createApiServer(router, opts) {
  const authToken = opts.token || process.env.AI_TUNNEL_API_TOKEN || null;
  const configPath = opts.configPath || null;

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Authenticate /api/* endpoints (skip the UI itself)
    if (authToken && path.startsWith("/api/")) {
      const provided = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (provided !== authToken) {
        return json(res, 401, { error: "Unauthorized — set Authorization: Bearer <token>" });
      }
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

      // GET /api/config — return raw YAML config
      if (path === "/api/config" && req.method === "GET") {
        return handleGetConfig(configPath, res);
      }

      // PUT /api/config — update entire config YAML
      if (path === "/api/config" && req.method === "PUT") {
        return await handlePutConfig(configPath, req, res);
      }

      // POST /api/channels — add a new channel to config
      if (path === "/api/channels" && req.method === "POST") {
        return await handleAddChannel(configPath, req, res);
      }

      // PUT /api/channels/:name — update a channel in config
      const updateChMatch = path.match(/^\/api\/channels\/([^/]+)$/);
      if (updateChMatch && req.method === "PUT") {
        return await handleUpdateChannel(configPath, decodeURIComponent(updateChMatch[1]), req, res);
      }

      // DELETE /api/channels/:name — delete a channel from config
      const deleteChMatch = path.match(/^\/api\/channels\/([^/]+)$/);
      if (deleteChMatch && req.method === "DELETE") {
        return await handleDeleteChannel(configPath, decodeURIComponent(deleteChMatch[1]), res);
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

  server.headersTimeout = 5000; // 5s for headers
  server.keepAliveTimeout = 15000; // 15s keep-alive
  server.timeout = 0; // SSE needs long-lived connections

  server.listen(opts.port, opts.host, () => {
    log("info", "UI", "Web UI available at http://%s:%d", opts.host, opts.port);
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
    version: "2.3.0",
  });
}

function handleListChannels(router, res) {
  json(res, 200, router.getAllChannels().map(channelToJSON));
}

function handleStats(router, res) {
  const channels = router.getAllChannels();
  let totalReq = 0, totalOk = 0, totalFail = 0;
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
      successRate: s.totalRequests > 0
        ? ((s.successCount / s.totalRequests) * 100).toFixed(1) + "%"
        : "N/A",
    };
  }

  json(res, 200, { totalRequests: totalReq, totalSuccess: totalOk, totalFail, channels: perChannel });
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
  if (body === null) return json(res, 413, { error: "Request body too large" });
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
  if (!removeKey(ch, keyIndex)) return json(res, 400, { error: `Invalid key index: ${keyIndex}` });
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
    } catch { /* client gone */ }
  });

  const hb = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* ignore */ }
  }, 15000);

  const cleanup = () => { unsub(); clearInterval(hb); };
  res.on("close", cleanup);
  res.on("error", cleanup);
}

// ─── Config Handlers ─────────────────────────────────

function handleGetConfig(configPath, res) {
  if (!configPath) return json(res, 500, { error: "Config path not available" });
  try {
    const content = readFileSync(configPath, "utf-8");
    json(res, 200, { path: configPath, content });
  } catch (e) {
    json(res, 500, { error: "Failed to read config: " + e.message });
  }
}

async function handlePutConfig(configPath, req, res) {
  if (!configPath) return json(res, 500, { error: "Config path not available" });
  const body = await readBody(req);
  if (body === null) return json(res, 413, { error: "Request body too large" });
  try {
    const { content } = JSON.parse(body);
    if (!content || typeof content !== "string") {
      return json(res, 400, { error: "Missing 'content' field (YAML string)" });
    }
    // Validate YAML
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== "object") {
      return json(res, 400, { error: "Invalid YAML: must be an object" });
    }
    // Basic structure check
    if (!parsed.channels && !parsed.sites) {
      return json(res, 400, { error: "Config must have 'channels' defined" });
    }
    writeFileSync(configPath, content, "utf-8");
    emit("config_reload_request", {});
    log("info", "Config", "Config updated via Web UI");
    json(res, 200, { ok: true, message: "Config saved and reload triggered" });
  } catch (e) {
    if (e instanceof SyntaxError) {
      return json(res, 400, { error: "Invalid JSON body" });
    }
    json(res, 400, { error: "Failed to save config: " + e.message });
  }
}

async function handleAddChannel(configPath, req, res) {
  if (!configPath) return json(res, 500, { error: "Config path not available" });
  const body = await readBody(req);
  if (body === null) return json(res, 413, { error: "Request body too large" });
  try {
    const channel = JSON.parse(body);
    if (!channel.name || !channel.target || !channel.keys || !channel.keys.length) {
      return json(res, 400, { error: "Channel needs name, target, and at least one key" });
    }
    const raw = readFileSync(configPath, "utf-8");
    const config = yaml.load(raw);
    if (!config.channels) config.channels = [];
    // Check duplicate
    if (config.channels.find(c => c.name === channel.name)) {
      return json(res, 409, { error: `Channel '${channel.name}' already exists` });
    }
    config.channels.push(channel);
    writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), "utf-8");
    emit("config_reload_request", {});
    log("info", "Config", "Channel '%s' added via Web UI", channel.name);
    json(res, 201, { ok: true, channel: channel.name });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

async function handleUpdateChannel(configPath, name, req, res) {
  if (!configPath) return json(res, 500, { error: "Config path not available" });
  const body = await readBody(req);
  if (body === null) return json(res, 413, { error: "Request body too large" });
  try {
    const updates = JSON.parse(body);
    const raw = readFileSync(configPath, "utf-8");
    const config = yaml.load(raw);
    if (!config.channels) return json(res, 404, { error: "No channels in config" });
    const idx = config.channels.findIndex(c => c.name === name);
    if (idx === -1) return json(res, 404, { error: `Channel '${name}' not found` });
    config.channels[idx] = { ...config.channels[idx], ...updates };
    writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), "utf-8");
    emit("config_reload_request", {});
    log("info", "Config", "Channel '%s' updated via Web UI", name);
    json(res, 200, { ok: true, channel: name });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

async function handleDeleteChannel(configPath, name, res) {
  if (!configPath) return json(res, 500, { error: "Config path not available" });
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = yaml.load(raw);
    if (!config.channels) return json(res, 404, { error: "No channels in config" });
    const idx = config.channels.findIndex(c => c.name === name);
    if (idx === -1) return json(res, 404, { error: `Channel '${name}' not found` });
    config.channels.splice(idx, 1);
    writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), "utf-8");
    emit("config_reload_request", {});
    log("info", "Config", "Channel '%s' deleted via Web UI", name);
    json(res, 200, { ok: true, deleted: name });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

// ─── Helpers ─────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const MAX_API_BODY_SIZE = 1024 * 1024; // 1 MB for API requests

function readBody(req) {
  return new Promise((r) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_API_BODY_SIZE) chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_API_BODY_SIZE) return r(null);
      r(Buffer.concat(chunks).toString());
    });
    req.on("error", () => r(null));
  });
}
