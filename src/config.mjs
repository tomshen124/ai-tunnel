// src/config.mjs - 配置加载

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";

const DEFAULT_CONFIG_NAME = "tunnel.config.yaml";

export function loadConfig(configPath) {
  const path = configPath || resolve(process.cwd(), DEFAULT_CONFIG_NAME);

  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\nRun 'ai-tunnel init' to create one.`
    );
  }

  const raw = readFileSync(path, "utf-8");
  const config = yaml.load(raw);

  // Validate
  if (!config.sites || !Array.isArray(config.sites) || config.sites.length === 0) {
    throw new Error("Config must have at least one site defined.");
  }

  for (const site of config.sites) {
    if (!site.name) throw new Error("Each site must have a 'name'.");
    if (!site.target) throw new Error(`Site '${site.name}' must have a 'target' URL.`);
    if (!site.localPort) throw new Error(`Site '${site.name}' must have a 'localPort'.`);
    if (!site.remotePort) throw new Error(`Site '${site.name}' must have a 'remotePort'.`);
  }

  // Defaults
  config.settings = {
    reconnectInterval: 5000,
    healthCheckInterval: 60000,
    logLevel: "info",
    ...config.settings,
  };

  return config;
}
