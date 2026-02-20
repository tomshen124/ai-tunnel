// src/proxy.mjs - Unified reverse proxy with router integration and retry/failover
//
// Key design decisions:
//   1. HTTP Agent with keep-alive per target (avoids TCP+TLS per request)
//   2. Strip all proxy-revealing headers (anti-detection)
//   3. Server-level and body-read timeouts (prevent hangs)
//   4. Client disconnect detection → abort upstream immediately
//   5. Respect 429 Retry-After header

import { createServer } from "http";
import { request as httpsRequest, Agent as HttpsAgent } from "https";
import { request as httpRequest, Agent as HttpAgent } from "http";
import { log, emit } from "./logger.mjs";
import {
  recordSuccess,
  recordFailure,
  markKeyFailed,
  markKeySuccess,
} from "./channel.mjs";
import { sleep } from "./retry.mjs";

// ─── Constants ──────────────────────────────────────────
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const BODY_READ_TIMEOUT_MS = 15000; // 15s to receive full body
const UPSTREAM_TIMEOUT_MS = 30000; // 30s upstream connect+headers
const MAX_SOCKETS_PER_TARGET = 16; // keep-alive pool size

// Headers that reveal we are a proxy — MUST strip before forwarding
const STRIP_HEADERS = new Set([
  // Hop-by-hop
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "proxy-authorization",
  // Proxy-indicator
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-real-ip",
  "via",
  "forwarded",
]);

// ─── Connection pool (per unique origin) ────────────────
const agentPool = new Map(); // "host:port:proto" → Agent

function getAgent(hostname, port, isHttps) {
  const key = `${hostname}:${port}:${isHttps ? "s" : ""}`;
  let agent = agentPool.get(key);
  if (!agent) {
    const Ctor = isHttps ? HttpsAgent : HttpAgent;
    agent = new Ctor({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: MAX_SOCKETS_PER_TARGET,
      maxFreeSockets: 4,
      timeout: 60000,
    });
    agentPool.set(key, agent);
    log("debug", "Pool", "Created agent for %s", key);
  }
  return agent;
}

/** Destroy all pooled agents (called on shutdown). */
export function destroyAgentPool() {
  for (const [key, agent] of agentPool) {
    agent.destroy();
  }
  agentPool.clear();
}

// ─── URL cache (avoid new URL() per request) ────────────
const urlCache = new Map();
function cachedURL(str) {
  let u = urlCache.get(str);
  if (!u) {
    u = new URL(str);
    urlCache.set(str, u);
  }
  return u;
}

// ─── Main entry ─────────────────────────────────────────

/**
 * Create the unified proxy server.
 */
export function createUnifiedProxy(router, retryCtrl, serverCfg) {
  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    const reqId = Math.random().toString(36).slice(2, 8);

    // Track client disconnect so we can abort early
    // Use res "close" — fires when TCP connection drops before response finishes
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) clientGone = true;
    });

    log("debug", "Proxy", "[%s] %s %s", reqId, req.method, req.url);

    // ── Buffer request body with timeout ─────────────
    let body;
    try {
      body = await readRequestBody(req);
    } catch (e) {
      if (!res.headersSent) {
        const code = e.code === "BODY_TOO_LARGE" ? 413 : 408;
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: e.message, type: "proxy_error" } }));
      }
      return;
    }

    // ── Retry loop ───────────────────────────────────
    const excludeChannels = [];
    let attempt = 0;
    const maxAttempts = retryCtrl.maxRetries + 1;

    while (attempt < maxAttempts) {
      // Bail out if client already disconnected
      if (clientGone) {
        log("debug", "Proxy", "[%s] Client disconnected, aborting", reqId);
        return;
      }

      const resolved =
        excludeChannels.length > 0
          ? router.resolveNext(req.url, excludeChannels)
          : router.resolve(req.url);

      if (!resolved) {
        const elapsed = Date.now() - startTime;
        log("error", "Proxy", "[%s] No available channel for %s (%dms)", reqId, req.url, elapsed);
        emit("request", { id: reqId, method: req.method, path: req.url, status: 503, elapsed, channel: null, error: "No available channel" });
        if (!res.headersSent) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "No available API channel", type: "proxy_error" } }));
        }
        return;
      }

      const { channel, key } = resolved;

      try {
        const result = await proxyRequest(req, res, body, channel, key, reqId, startTime, clientGone);

        if (result.success) return;

        const { statusCode, retryAfterMs } = result;

        // Non-retryable → forward as-is
        if (!retryCtrl.shouldRetry(statusCode) && !retryCtrl.isKeyFailure(statusCode)) {
          if (!res.headersSent) {
            res.writeHead(statusCode, { "content-type": "application/json" });
            res.end(result.responseBody || JSON.stringify({ error: { message: `Upstream error: ${statusCode}`, type: "upstream_error" } }));
          }
          return;
        }

        // Key failure (401/403)
        if (retryCtrl.isKeyFailure(statusCode)) {
          markKeyFailed(channel, key.index);
          log("warn", channel.name, "[%s] Key #%d failed (%d), rotating...", reqId, key.index, statusCode);
        }

        // Channel failure (5xx)
        if (retryCtrl.isChannelFailure(statusCode)) {
          excludeChannels.push(channel.name);
          recordFailure(channel, `HTTP ${statusCode}`);
          log("warn", channel.name, "[%s] Channel error (%d), failing over...", reqId, statusCode);
        }

        // Rate limited (429) — respect Retry-After if provided
        if (statusCode === 429) {
          markKeyFailed(channel, key.index);
          log("warn", channel.name, "[%s] Rate limited, backing off...", reqId);
        }

        attempt++;
        if (attempt < maxAttempts) {
          // Use upstream Retry-After if available, otherwise our own backoff
          const delay = retryAfterMs || retryCtrl.getDelay(attempt - 1);
          log("info", "Retry", "[%s] Attempt %d/%d in %dms", reqId, attempt + 1, maxAttempts, Math.round(delay));
          emit("retry", { id: reqId, attempt, maxAttempts, fromChannel: channel.name, delay: Math.round(delay) });
          await sleep(delay);
        }
      } catch (err) {
        recordFailure(channel, err.message);
        excludeChannels.push(channel.name);

        attempt++;
        if (attempt < maxAttempts) {
          const delay = retryCtrl.getDelay(attempt - 1);
          log("warn", channel.name, "[%s] Error: %s, retrying in %dms", reqId, err.message, Math.round(delay));
          emit("retry", { id: reqId, attempt, maxAttempts, fromChannel: channel.name, delay: Math.round(delay) });
          await sleep(delay);
        } else {
          const elapsed = Date.now() - startTime;
          log("error", "Proxy", "[%s] All retries exhausted (%dms)", reqId, elapsed);
          emit("request", { id: reqId, method: req.method, path: req.url, status: 502, elapsed, channel: channel.name, error: err.message });
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: `All retries exhausted: ${err.message}`, type: "proxy_error" } }));
          }
          return;
        }
      }
    }

    // Fallthrough guard
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Proxy error: retries exhausted", type: "proxy_error" } }));
    }
  });

  // ── Server-level timeouts (prevent slow-client hangs) ──
  server.headersTimeout = 10000; // 10s to receive headers
  server.requestTimeout = 180000; // 3min total (covers long SSE streams)
  server.keepAliveTimeout = 30000; // 30s keep-alive idle
  server.timeout = 0; // disable per-socket timeout (we manage our own)

  server.listen(serverCfg.port, serverCfg.host, () => {
    log("info", "Proxy", "Unified proxy listening on %s:%d", serverCfg.host, serverCfg.port);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log("error", "Proxy", "Port %d already in use", serverCfg.port);
    } else {
      log("error", "Proxy", "Server error: %s", e.message);
    }
  });

  return server;
}

// ─── Body reader with timeout ───────────────────────────

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        req.destroy();
        const err = new Error("Request body read timeout");
        err.code = "BODY_TIMEOUT";
        reject(err);
      }
    }, BODY_READ_TIMEOUT_MS);

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          req.destroy();
          const err = new Error("Request body too large");
          err.code = "BODY_TOO_LARGE";
          reject(err);
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      }
    });

    req.on("error", (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  });
}

// ─── Single proxy request ───────────────────────────────

function proxyRequest(req, res, body, channel, key, reqId, startTime, clientGone) {
  return new Promise((resolve, reject) => {
    // Always connect directly to the target URL.
    // SSH tunnels are inbound (VPS → local); the proxy itself goes outbound
    // to the real API endpoint over the local network / residential IP.
    const targetUrl = cachedURL(channel.target);

    const isHttps = targetUrl.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const agent = getAgent(targetUrl.hostname, targetUrl.port || (isHttps ? 443 : 80), isHttps);
    const targetHost = cachedURL(channel.target).hostname;

    const opts = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: req.url,
      method: req.method,
      timeout: UPSTREAM_TIMEOUT_MS,
      agent,
      headers: {
        ...sanitizeHeaders(req.headers),
        host: targetHost,
        authorization: `Bearer ${key.value}`,
        "content-length": String(body.length),
      },
    };

    const proxy = requestFn(opts, (pRes) => {
      const elapsed = Date.now() - startTime;
      const statusCode = pRes.statusCode;

      log(
        statusCode < 400 ? "info" : "warn",
        channel.name,
        "[%s] %s %s → %d (%dms)",
        reqId, req.method, req.url, statusCode, elapsed
      );

      // ── Retryable status → buffer response, return to caller ──
      if (
        statusCode === 429 || statusCode === 401 || statusCode === 403 ||
        statusCode === 502 || statusCode === 503 || statusCode === 504
      ) {
        const chunks = [];
        pRes.on("data", (c) => chunks.push(c));
        pRes.on("end", () => {
          // Parse Retry-After header (seconds or HTTP-date)
          let retryAfterMs = null;
          const ra = pRes.headers["retry-after"];
          if (ra) {
            const secs = parseInt(ra, 10);
            if (!isNaN(secs)) {
              retryAfterMs = secs * 1000;
            } else {
              const date = new Date(ra);
              if (!isNaN(date)) retryAfterMs = Math.max(0, date - Date.now());
            }
          }
          resolve({ success: false, statusCode, responseBody: Buffer.concat(chunks).toString(), retryAfterMs });
        });
        pRes.on("error", () => resolve({ success: false, statusCode, responseBody: null, retryAfterMs: null }));
        return;
      }

      // ── Non-retryable → stream directly to client ──
      if (statusCode < 400) {
        recordSuccess(channel, elapsed);
        markKeySuccess(channel, key.index);
      }

      emit("request", { id: reqId, method: req.method, path: req.url, status: statusCode, elapsed, channel: channel.name });

      // Pass through headers; disable buffering for SSE
      const headers = { ...pRes.headers };
      if (headers["content-type"]?.includes("text/event-stream")) {
        headers["cache-control"] = "no-cache";
        headers["x-accel-buffering"] = "no";
      }

      res.writeHead(statusCode, headers);
      pRes.pipe(res);

      // If client disconnects during streaming, tear down upstream
      res.on("close", () => {
        if (!pRes.complete) pRes.destroy();
      });

      pRes.on("error", (e) => {
        log("error", channel.name, "[%s] Response stream error: %s", reqId, e.message);
        res.end();
      });

      resolve({ success: true, statusCode });
    });

    proxy.on("error", (e) => reject(e));
    proxy.on("timeout", () => {
      proxy.destroy(new Error(`Upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`));
    });

    // Send buffered body
    if (body.length > 0) {
      proxy.end(body);
    } else {
      proxy.end();
    }
  });
}

// ─── Header sanitization (anti-detection) ───────────────

function sanitizeHeaders(headers) {
  const clean = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (STRIP_HEADERS.has(lower)) continue;
    // Don't forward the original authorization — we set our own
    if (lower === "authorization") continue;
    // Don't forward original content-length — we recalculate from buffered body
    if (lower === "content-length") continue;
    clean[key] = value;
  }
  return clean;
}
