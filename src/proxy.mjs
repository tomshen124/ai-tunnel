// src/proxy.mjs - Unified reverse proxy with router integration and retry/failover

import { createServer } from "http";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { log, emit } from "./logger.mjs";
import {
  recordSuccess,
  recordFailure,
  markKeyFailed,
  markKeySuccess,
} from "./channel.mjs";
import { sleep } from "./retry.mjs";

/**
 * Create the unified proxy server.
 * All incoming requests go through the router to select channel + key.
 *
 * @param {object} router - Router engine
 * @param {object} retryCtrl - Retry controller
 * @param {object} serverCfg - { port, host }
 */
export function createUnifiedProxy(router, retryCtrl, serverCfg) {
  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    const reqId = Math.random().toString(36).slice(2, 8);

    log("debug", "Proxy", "[%s] %s %s", reqId, req.method, req.url);

    // Buffer the request body so we can replay on retry
    const bodyChunks = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const body = Buffer.concat(bodyChunks);

    // Attempt routing with retries
    const excludeChannels = [];
    let attempt = 0;
    const maxAttempts = retryCtrl.maxRetries + 1;

    while (attempt < maxAttempts) {
      // Pick a channel (exclude previously failed channels for channel-level errors)
      const resolved =
        excludeChannels.length > 0
          ? router.resolveNext(req.url, excludeChannels)
          : router.resolve(req.url);

      if (!resolved) {
        const elapsed = Date.now() - startTime;
        log("error", "Proxy", "[%s] No available channel for %s (%dms)", reqId, req.url, elapsed);
        emit("request", {
          id: reqId,
          method: req.method,
          path: req.url,
          status: 503,
          elapsed,
          channel: null,
          error: "No available channel",
        });
        if (!res.headersSent) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: "No available API channel",
                type: "proxy_error",
              },
            })
          );
        }
        return;
      }

      const { channel, key } = resolved;

      try {
        const result = await proxyRequest(
          req,
          res,
          body,
          channel,
          key,
          reqId,
          startTime
        );

        // Success or non-retryable status
        if (result.success) {
          return; // Response already sent
        }

        // Check if we should retry
        const { statusCode, responseBody } = result;

        if (!retryCtrl.shouldRetry(statusCode) && !retryCtrl.isKeyFailure(statusCode)) {
          // Non-retryable error — forward the original response to client
          if (!res.headersSent) {
            res.writeHead(statusCode, { "content-type": "application/json" });
            res.end(responseBody || JSON.stringify({ error: { message: `Upstream error: ${statusCode}`, type: "upstream_error" } }));
          }
          return;
        }

        // Key-level failure: mark key, try same channel with different key
        if (retryCtrl.isKeyFailure(statusCode)) {
          markKeyFailed(channel, key.index);
          log("warn", channel.name, "[%s] Key #%d failed (%d), rotating...", reqId, key.index, statusCode);
        }

        // Channel-level failure: exclude this channel, try another
        if (retryCtrl.isChannelFailure(statusCode)) {
          excludeChannels.push(channel.name);
          recordFailure(channel, `HTTP ${statusCode}`);
          log("warn", channel.name, "[%s] Channel error (%d), failing over...", reqId, statusCode);
        }

        // Rate limited: wait before retry
        if (statusCode === 429) {
          markKeyFailed(channel, key.index);
          log("warn", channel.name, "[%s] Rate limited, backing off...", reqId);
        }

        attempt++;
        if (attempt < maxAttempts) {
          const delay = retryCtrl.getDelay(attempt - 1);
          log("info", "Retry", "[%s] Attempt %d/%d in %dms", reqId, attempt + 1, maxAttempts, Math.round(delay));
          emit("retry", {
            id: reqId,
            attempt,
            maxAttempts,
            fromChannel: channel.name,
            delay: Math.round(delay),
          });
          await sleep(delay);
        }
      } catch (err) {
        // Network error or proxy error
        recordFailure(channel, err.message);
        excludeChannels.push(channel.name);

        attempt++;
        if (attempt < maxAttempts) {
          const delay = retryCtrl.getDelay(attempt - 1);
          log("warn", channel.name, "[%s] Error: %s, retrying in %dms", reqId, err.message, Math.round(delay));
          emit("retry", {
            id: reqId,
            attempt,
            maxAttempts,
            fromChannel: channel.name,
            delay: Math.round(delay),
          });
          await sleep(delay);
        } else {
          // All retries exhausted
          const elapsed = Date.now() - startTime;
          log("error", "Proxy", "[%s] All retries exhausted (%dms)", reqId, elapsed);
          emit("request", {
            id: reqId,
            method: req.method,
            path: req.url,
            status: 502,
            elapsed,
            channel: channel.name,
            error: err.message,
          });
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  message: `All retries exhausted: ${err.message}`,
                  type: "proxy_error",
                },
              })
            );
          }
          return;
        }
      }
    }

    // Should not reach here, but just in case
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Proxy error: retries exhausted", type: "proxy_error" },
        })
      );
    }
  });

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

/**
 * Proxy a single request to a specific channel + key.
 * Returns { success, statusCode } — does NOT send response on retryable errors
 * (the caller needs to check and decide whether to retry).
 *
 * For non-retryable responses (success or client errors), the response is streamed directly.
 */
function proxyRequest(req, res, body, channel, key, reqId, startTime) {
  return new Promise((resolve, reject) => {
    // Determine effective target: tunnel local port or direct
    let targetUrl;
    if (channel.tunnel?.enabled && channel.tunnel.localPort) {
      targetUrl = new URL(`http://127.0.0.1:${channel.tunnel.localPort}`);
    } else {
      targetUrl = new URL(channel.target);
    }

    const isHttps = targetUrl.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const opts = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: {
        ...filterHopHeaders(req.headers),
        host: new URL(channel.target).hostname,
        authorization: `Bearer ${key.value}`,
      },
    };

    const proxy = requestFn(opts, (pRes) => {
      const elapsed = Date.now() - startTime;
      const statusCode = pRes.statusCode;

      log(
        statusCode < 400 ? "info" : "warn",
        channel.name,
        "[%s] %s %s → %d (%dms)",
        reqId,
        req.method,
        req.url,
        statusCode,
        elapsed
      );

      // If retryable and we haven't sent headers, buffer the error response
      // and return control to the caller for retry
      if (
        statusCode === 429 ||
        statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 502 ||
        statusCode === 503 ||
        statusCode === 504
      ) {
        // Consume the response body to free the connection
        const chunks = [];
        pRes.on("data", (c) => chunks.push(c));
        pRes.on("end", () => {
          if (statusCode >= 500 || statusCode === 429) {
            recordFailure(channel, `HTTP ${statusCode}`);
          }
          if (statusCode === 401 || statusCode === 403) {
            markKeyFailed(channel, key.index);
          }
          resolve({ success: false, statusCode, responseBody: Buffer.concat(chunks).toString() });
        });
        pRes.on("error", () => resolve({ success: false, statusCode, responseBody: null }));
        return;
      }

      // Non-retryable: stream the response directly
      if (statusCode < 400) {
        recordSuccess(channel, elapsed);
        markKeySuccess(channel, key.index);
      }

      emit("request", {
        id: reqId,
        method: req.method,
        path: req.url,
        status: statusCode,
        elapsed,
        channel: channel.name,
      });

      // Pass through headers, ensuring SSE streams aren't buffered
      const headers = { ...pRes.headers };
      if (headers["content-type"]?.includes("text/event-stream")) {
        headers["cache-control"] = "no-cache";
        headers["x-accel-buffering"] = "no";
      }

      res.writeHead(statusCode, headers);
      pRes.pipe(res);

      pRes.on("error", (e) => {
        log("error", channel.name, "[%s] Response stream error: %s", reqId, e.message);
        res.end();
      });

      resolve({ success: true, statusCode });
    });

    proxy.on("error", (e) => {
      reject(e);
    });

    // Send the buffered body
    if (body.length > 0) {
      proxy.end(body);
    } else {
      proxy.end();
    }
  });
}

/**
 * Filter out hop-by-hop headers.
 */
function filterHopHeaders(headers) {
  const filtered = { ...headers };
  delete filtered["connection"];
  delete filtered["keep-alive"];
  delete filtered["transfer-encoding"];
  delete filtered["upgrade"];
  delete filtered["proxy-connection"];
  return filtered;
}
