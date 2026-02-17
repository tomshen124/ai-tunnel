// src/router.mjs - Routing engine (strategy selection, failover)

import { isAvailable, pickKey } from "./channel.mjs";
import { log } from "./logger.mjs";

/**
 * Create the router engine.
 * Holds route groups and channel pool; selects channels for incoming requests.
 */
export function createRouter(channels, routes) {
  const channelMap = new Map();
  for (const ch of channels) {
    channelMap.set(ch.name, ch);
  }

  return {
    channelMap,
    routes: routes || [],

    /**
     * Resolve a request path to a route group and pick a channel + key.
     * Returns { channel, key } or null if nothing available.
     */
    resolve(path) {
      const route = matchRoute(this.routes, path);
      if (!route) {
        // Default: try all channels in weight order
        return pickFromChannels([...channelMap.values()], "priority");
      }
      const routeChannels = route.channels
        .map((n) => channelMap.get(n))
        .filter(Boolean);
      return pickFromChannels(routeChannels, route.strategy || "priority");
    },

    /**
     * Resolve next channel after a failure, excluding specific channels.
     * Used for failover during retry.
     */
    resolveNext(path, excludeNames) {
      const route = matchRoute(this.routes, path);
      const pool = route
        ? route.channels.map((n) => channelMap.get(n)).filter(Boolean)
        : [...channelMap.values()];

      const filtered = pool.filter((ch) => !excludeNames.includes(ch.name));
      return pickFromChannels(filtered, route?.strategy || "priority");
    },

    /**
     * Get a channel by name.
     */
    getChannel(name) {
      return channelMap.get(name);
    },

    /**
     * Get all channels.
     */
    getAllChannels() {
      return [...channelMap.values()];
    },

    /**
     * Update channels and routes (for hot reload).
     */
    update(newChannels, newRoutes) {
      channelMap.clear();
      for (const ch of newChannels) {
        channelMap.set(ch.name, ch);
      }
      this.routes = newRoutes || [];
    },
  };
}

/**
 * Match a request path against route groups.
 * Supports glob patterns like /v1/** .
 */
function matchRoute(routes, reqPath) {
  for (const route of routes) {
    if (pathMatches(route.path, reqPath)) {
      return route;
    }
  }
  return null;
}

/**
 * Simple glob path matcher.
 * /v1/** matches /v1/chat/completions, /v1/models, etc.
 */
function pathMatches(pattern, path) {
  if (pattern === "/**" || pattern === "*") return true;

  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(prefix + "/");
  }

  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    const rest = path.slice(prefix.length);
    return path.startsWith(prefix) && !rest.slice(1).includes("/");
  }

  return pattern === path;
}

// ─── Strategy implementations ──────────────────────────

// Round-robin state per route (keyed by channel list hash)
const rrCounters = new Map();

function pickFromChannels(channels, strategy) {
  const available = channels.filter(isAvailable);
  if (available.length === 0) {
    // Last resort: try fallback channels even if unhealthy (but enabled)
    const fallbacks = channels.filter((ch) => ch.enabled && ch.fallback);
    if (fallbacks.length > 0) {
      return pickWithKey(fallbacks[0]);
    }
    return null;
  }

  let picked;

  switch (strategy) {
    case "round-robin": {
      const key = available.map((c) => c.name).join(",");
      const idx = (rrCounters.get(key) || 0) % available.length;
      rrCounters.set(key, idx + 1);
      picked = available[idx];
      break;
    }

    case "lowest-latency": {
      // Sort by latency (null latency goes last)
      const sorted = [...available].sort((a, b) => {
        if (a.latency == null) return 1;
        if (b.latency == null) return -1;
        return a.latency - b.latency;
      });
      picked = sorted[0];
      break;
    }

    case "priority":
    default: {
      // Sort by weight descending, non-fallback first
      const sorted = [...available].sort((a, b) => {
        if (a.fallback !== b.fallback) return a.fallback ? 1 : -1;
        return b.weight - a.weight;
      });
      picked = sorted[0];
      break;
    }
  }

  return pickWithKey(picked);
}

function pickWithKey(channel) {
  const key = pickKey(channel);
  if (!key) {
    log("warn", channel.name, "No alive keys available");
    return null;
  }
  return { channel, key };
}
