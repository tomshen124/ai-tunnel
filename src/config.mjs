// src/config.mjs - Configuration loading, validation, hot reload, v1 compat

import { readFileSync, existsSync, watchFile, unwatchFile } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";
import { log } from "./logger.mjs";

const DEFAULT_CONFIG_NAME = "tunnel.config.yaml";

const DEFAULT_SETTINGS = {
  reconnectInterval: 5000,
  logLevel: "info",
  hotReload: true,
  retry: {
    maxRetries: 3,
    retryOn: [429, 502, 503, 504],
    backoff: "exponential",
    baseDelayMs: 1000,
    maxDelayMs: 10000,
  },
};

const DEFAULT_SERVER = {
  port: 9000,
  host: "127.0.0.1",
  ui: {
    enabled: true,
    port: 3000,
    host: "127.0.0.1",
  },
};

/**
 * Load and validate config file.
 * Supports both v1 (sites) and v2 (channels) formats.
 */
export function loadConfig(configPath) {
  const path =
    configPath ||
    process.env.TUNNEL_CONFIG ||
    process.env.AI_TUNNEL_CONFIG ||
    resolve(process.cwd(), DEFAULT_CONFIG_NAME);

  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\nRun 'ai-tunnel init' to create one.`
    );
  }

  const raw = readFileSync(path, "utf-8");
  const config = yaml.load(raw);

  // Convert v1 format (sites) to v2 format (channels) if needed
  if (config.sites && !config.channels) {
    config.channels = convertV1Sites(config.sites);
    delete config.sites;
    log("info", "Config", "Converted v1 sites to v2 channels format");
  }

  // Validate channels
  if (!config.channels || !Array.isArray(config.channels) || config.channels.length === 0) {
    throw new Error("Config must have at least one channel (or site) defined.");
  }

  for (const ch of config.channels) {
    validateChannel(ch);
  }

  // Apply defaults
  config.settings = deepMerge(DEFAULT_SETTINGS, config.settings || {});
  config.server = deepMerge(DEFAULT_SERVER, config.server || {});
  config.routes = config.routes || buildDefaultRoutes(config.channels);
  config.ssh = config.ssh || null;
  config.notifications = config.notifications || null;

  // Optional: protect Web UI/API with a Bearer token
  // (used by api.mjs; keep it out of server defaults)
  config.uiAuthToken = config.uiAuthToken || null;

  // Stash the resolved path for hot reload
  config._path = path;

  return config;
}

/**
 * Convert v1 sites array to v2 channels array.
 * Preserves SSH tunnel config per-channel.
 */
function convertV1Sites(sites) {
  return sites.map((site) => ({
    name: site.name,
    target: site.target,
    keys: site.headers?.Authorization
      ? [site.headers.Authorization.replace(/^Bearer\s+/, "")]
      : [],
    keyStrategy: "round-robin",
    weight: 10,
    tunnel: {
      enabled: true,
      localPort: site.localPort,
      remotePort: site.remotePort,
    },
    healthCheck: site.healthCheck
      ? { path: site.healthCheck, intervalMs: 60000, timeoutMs: 5000 }
      : null,
  }));
}

/**
 * Validate a single channel config.
 */
function validateChannel(ch) {
  if (!ch.name) throw new Error("Each channel must have a 'name'.");
  if (!ch.target) throw new Error(`Channel '${ch.name}' must have a 'target' URL.`);
  if (!ch.keys || !Array.isArray(ch.keys) || ch.keys.length === 0) {
    throw new Error(`Channel '${ch.name}' must have at least one key.`);
  }
}

/**
 * Build a default catch-all route if no routes defined.
 */
function buildDefaultRoutes(channels) {
  return [
    {
      path: "/**",
      channels: channels.map((ch) => ch.name),
      strategy: "priority",
    },
  ];
}

/**
 * Watch config file for changes and invoke callback on reload.
 * Returns an unwatch function.
 */
export function watchConfig(configPath, onChange) {
  const path = configPath || resolve(process.cwd(), DEFAULT_CONFIG_NAME);
  let debounceTimer = null;

  watchFile(path, { interval: 1000 }, () => {
    // Debounce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      log("info", "Config", "File changed, reloading...");
      try {
        const newConfig = loadConfig(path);
        onChange(newConfig);
        log("info", "Config", "Reloaded successfully");
      } catch (e) {
        log("error", "Config", "Reload failed: %s", e.message);
      }
    }, 500);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unwatchFile(path);
  };
}

/**
 * Deep merge two objects (target wins over source for defined values).
 */
function deepMerge(source, target) {
  const result = { ...source };
  for (const key of Object.keys(target)) {
    if (
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key]) &&
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(source[key], target[key]);
    } else if (target[key] !== undefined) {
      result[key] = target[key];
    }
  }
  return result;
}
