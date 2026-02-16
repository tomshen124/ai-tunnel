// src/health.mjs - Periodic health checks for channels

import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { log, emit } from "./logger.mjs";
import { setHealth } from "./channel.mjs";

const UNHEALTHY_THRESHOLD = 3;

/**
 * Start health checking for all channels.
 * Returns a stop function.
 */
export function startHealthChecks(channels) {
  const timers = [];

  for (const ch of channels) {
    if (!ch.healthCheck?.path) continue;

    const intervalMs = ch.healthCheck.intervalMs || 60000;
    const timeoutMs = ch.healthCheck.timeoutMs || 5000;

    // Run immediately, then on interval
    checkChannel(ch, timeoutMs);
    const timer = setInterval(() => checkChannel(ch, timeoutMs), intervalMs);
    timers.push(timer);

    log("debug", ch.name, "Health check every %dms on %s", intervalMs, ch.healthCheck.path);
  }

  return () => {
    for (const t of timers) clearInterval(t);
  };
}

/**
 * Run a single health check on a channel.
 */
function checkChannel(channel, timeoutMs) {
  const start = Date.now();

  let targetUrl;
  if (channel.tunnel?.enabled && channel.tunnel.localPort) {
    targetUrl = new URL(`http://127.0.0.1:${channel.tunnel.localPort}`);
  } else {
    targetUrl = new URL(channel.target);
  }

  const isHttps = targetUrl.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const checkPath = channel.healthCheck.path;

  const opts = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: checkPath,
    method: "GET",
    headers: {
      host: new URL(channel.target).hostname,
    },
    timeout: timeoutMs,
  };

  // Use the first alive key for auth
  const aliveKey = channel._keys.find((k) => k.alive);
  if (aliveKey) {
    opts.headers.authorization = `Bearer ${aliveKey.value}`;
  }

  const req = requestFn(opts, (res) => {
    const elapsed = Date.now() - start;

    // Consume the body
    res.resume();

    if (res.statusCode >= 200 && res.statusCode < 400) {
      const wasUnhealthy = channel.health === "unhealthy";
      setHealth(channel, "healthy", elapsed);
      if (wasUnhealthy) {
        log("info", channel.name, "Health check passed (%dms) — recovered", elapsed);
        emit("health", { channel: channel.name, status: "healthy", latency: elapsed });
      } else {
        log("debug", channel.name, "Health check OK (%dms)", elapsed);
      }
    } else {
      handleCheckFailure(channel, `HTTP ${res.statusCode}`);
    }
  });

  req.on("timeout", () => {
    req.destroy();
    handleCheckFailure(channel, "timeout");
  });

  req.on("error", (e) => {
    handleCheckFailure(channel, e.message);
  });

  req.end();
}

function handleCheckFailure(channel, reason) {
  channel.consecutiveFails = (channel.consecutiveFails || 0) + 1;

  if (channel.consecutiveFails >= UNHEALTHY_THRESHOLD) {
    const wasHealthy = channel.health !== "unhealthy";
    setHealth(channel, "unhealthy", null);
    if (wasHealthy) {
      log("warn", channel.name, "Health check failed (%s) — marked unhealthy", reason);
      emit("health", { channel: channel.name, status: "unhealthy", reason });
    }
  } else {
    log("debug", channel.name, "Health check failed (%s) [%d/%d]", reason, channel.consecutiveFails, UNHEALTHY_THRESHOLD);
  }
}
