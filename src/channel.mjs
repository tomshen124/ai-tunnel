// src/channel.mjs - Channel management (key pool, health state, stats)

import { log } from "./logger.mjs";

/**
 * Create a Channel instance from config.
 *
 * A channel represents a single API endpoint with a pool of keys,
 * health tracking, and request statistics.
 */
export function createChannel(cfg) {
  const keys = (cfg.keys || []).map((k) => ({
    value: k,
    alive: true,
    failCount: 0,
  }));

  const channel = {
    name: cfg.name,
    target: cfg.target,
    weight: cfg.weight ?? 10,
    fallback: cfg.fallback ?? false,
    keyStrategy: cfg.keyStrategy || "round-robin",
    maxRetries: cfg.maxRetries ?? 2,
    enabled: true,
    tunnel: cfg.tunnel || null,
    healthCheck: cfg.healthCheck || null,

    // Runtime state
    health: "unknown", // unknown | healthy | unhealthy
    latency: null,
    consecutiveFails: 0,

    // Key pool state
    _keys: keys,
    _keyIndex: 0,

    // Stats
    stats: {
      totalRequests: 0,
      successCount: 0,
      failCount: 0,
      lastRequestAt: null,
      lastError: null,
    },
  };

  return channel;
}

/**
 * Pick the next API key using the configured strategy.
 * Returns { value, index } or null if no alive keys.
 */
export function pickKey(channel) {
  const alive = channel._keys.filter((k) => k.alive);
  if (alive.length === 0) return null;

  let picked;
  if (channel.keyStrategy === "random") {
    picked = alive[Math.floor(Math.random() * alive.length)];
  } else {
    // round-robin (default)
    // find next alive key starting from _keyIndex
    const total = channel._keys.length;
    for (let i = 0; i < total; i++) {
      const idx = (channel._keyIndex + i) % total;
      if (channel._keys[idx].alive) {
        picked = channel._keys[idx];
        channel._keyIndex = (idx + 1) % total;
        break;
      }
    }
  }

  if (!picked) return null;

  const idx = channel._keys.indexOf(picked);
  return { value: picked.value, index: idx };
}

/**
 * Mark a key as failed (e.g., 401/403 response).
 * After too many failures, the key is disabled.
 */
export function markKeyFailed(channel, keyIndex) {
  const key = channel._keys[keyIndex];
  if (!key) return;

  key.failCount++;
  if (key.failCount >= 3) {
    key.alive = false;
    log("warn", channel.name, "Key #%d disabled after %d failures", keyIndex, key.failCount);
  }
}

/**
 * Reset a key's failure counter (on success).
 */
export function markKeySuccess(channel, keyIndex) {
  const key = channel._keys[keyIndex];
  if (!key) return;
  key.failCount = 0;
  key.alive = true;
}

/**
 * Record a successful request on the channel.
 */
export function recordSuccess(channel, latencyMs) {
  channel.stats.totalRequests++;
  channel.stats.successCount++;
  channel.stats.lastRequestAt = Date.now();
  channel.latency = latencyMs;
  channel.consecutiveFails = 0;
  if (channel.health !== "healthy") {
    channel.health = "healthy";
  }
}

/**
 * Record a failed request on the channel.
 */
export function recordFailure(channel, error) {
  channel.stats.totalRequests++;
  channel.stats.failCount++;
  channel.stats.lastRequestAt = Date.now();
  channel.stats.lastError = error;
  channel.consecutiveFails++;

  if (channel.consecutiveFails >= 3) {
    channel.health = "unhealthy";
    log("warn", channel.name, "Marked unhealthy after %d consecutive failures", channel.consecutiveFails);
  }
}

/**
 * Mark channel health directly (used by health checker).
 */
export function setHealth(channel, status, latencyMs) {
  channel.health = status;
  if (status === "healthy" && latencyMs != null) {
    channel.latency = latencyMs;
    channel.consecutiveFails = 0;
  }
}

/**
 * Get count of alive keys vs total.
 */
export function keyStats(channel) {
  const total = channel._keys.length;
  const alive = channel._keys.filter((k) => k.alive).length;
  return { alive, total };
}

/**
 * Check if a channel is available for routing.
 */
export function isAvailable(channel) {
  return channel.enabled && channel.health !== "unhealthy" && keyStats(channel).alive > 0;
}

/**
 * Serialize channel to JSON for API responses.
 */
export function channelToJSON(channel) {
  const ks = keyStats(channel);
  return {
    name: channel.name,
    target: channel.target,
    weight: channel.weight,
    fallback: channel.fallback,
    enabled: channel.enabled,
    health: channel.health,
    latency: channel.latency,
    keyStrategy: channel.keyStrategy,
    keys: {
      alive: ks.alive,
      total: ks.total,
    },
    stats: { ...channel.stats },
    tunnel: channel.tunnel ? { enabled: channel.tunnel.enabled } : null,
  };
}

/**
 * Add a key to a channel at runtime.
 */
export function addKey(channel, keyValue) {
  channel._keys.push({ value: keyValue, alive: true, failCount: 0 });
  log("info", channel.name, "Key added (total: %d)", channel._keys.length);
}

/**
 * Remove a key from a channel by index.
 */
export function removeKey(channel, keyIndex) {
  if (keyIndex < 0 || keyIndex >= channel._keys.length) return false;
  channel._keys.splice(keyIndex, 1);
  if (channel._keyIndex >= channel._keys.length) {
    channel._keyIndex = 0;
  }
  log("info", channel.name, "Key #%d removed (total: %d)", keyIndex, channel._keys.length);
  return true;
}
