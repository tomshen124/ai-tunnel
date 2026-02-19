#!/usr/bin/env node
// src/cli.mjs - CLI entry point (v2)

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, copyFileSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0] || "start";

/**
 * Read UI port/host from config file (best-effort).
 */
function getUiAddress() {
  const configPath = process.env.TUNNEL_CONFIG || resolve(process.cwd(), "tunnel.config.yaml");
  try {
    const raw = readFileSync(configPath, "utf-8");
    // Simple YAML parsing for ui port/host without importing js-yaml
    const portMatch = raw.match(/ui:\s*\n(?:\s+enabled:[^\n]*\n)?\s+port:\s*(\d+)/);
    const hostMatch = raw.match(/ui:\s*\n(?:\s+enabled:[^\n]*\n)?(?:\s+port:[^\n]*\n)?\s+host:\s*["']?([^"'\s\n]+)/);
    return {
      host: hostMatch?.[1] || "127.0.0.1",
      port: parseInt(portMatch?.[1]) || 3000,
    };
  } catch {
    return { host: "127.0.0.1", port: 3000 };
  }
}

switch (command) {
  case "start":
    await import("./index.mjs");
    break;

  case "init": {
    const dest = resolve(process.cwd(), "tunnel.config.yaml");
    if (existsSync(dest)) {
      console.log("⚠️  tunnel.config.yaml already exists. Skipping.");
    } else {
      const src = resolve(__dirname, "..", "tunnel.config.example.yaml");
      copyFileSync(src, dest);
      console.log("✅ Created tunnel.config.yaml — edit it with your settings.");
    }
    break;
  }

  case "status":
    try {
      const ui = getUiAddress();
      const uiBase = `http://${ui.host}:${ui.port}`;
      const res = await fetch(`${uiBase}/api/status`);
      const data = await res.json();
      const h = Math.floor(data.uptime / 3600);
      const m = Math.floor((data.uptime % 3600) / 60);
      console.log(`🚇 AI-Tunnel ${data.version}`);
      console.log(`   Status:   ${data.status}`);
      console.log(`   Uptime:   ${h}h ${m}m`);
      console.log(`   Channels: ${data.channels.healthy}/${data.channels.total} healthy`);

      const chRes = await fetch(`${uiBase}/api/channels`);
      const channels = await chRes.json();
      console.log("");
      for (const ch of channels) {
        const icon = !ch.enabled ? "⏸" : ch.health === "healthy" ? "🟢" : ch.health === "unhealthy" ? "🔴" : "🟡";
        const latency = ch.latency != null ? `${ch.latency}ms` : "--";
        console.log(`   ${icon} ${ch.name.padEnd(20)} ${latency.padStart(6)}  keys: ${ch.keys.alive}/${ch.keys.total}  reqs: ${ch.stats.totalRequests}`);
      }
    } catch {
      console.log("❌ AI-Tunnel is not running (cannot connect to Web UI)");
    }
    break;

  case "stop":
    try {
      // Send SIGTERM to the running process (cross-platform)
      console.log("🛑 Sending stop signal...");
      const { execSync } = await import("child_process");
      const isWin = process.platform === "win32";
      let pid;
      if (isWin) {
        const out = execSync(
          'wmic process where "CommandLine like \'%ai-tunnel%index.mjs%\' and Name=\'node.exe\'" get ProcessId /format:list',
          { encoding: "utf-8" }
        ).trim();
        const match = out.match(/ProcessId=(\d+)/);
        pid = match ? match[1] : null;
      } else {
        // Match specifically ai-tunnel's index.mjs, exclude the current stop process
        const out = execSync("pgrep -f 'node.*(src/index\\.mjs|ai-tunnel.*start)'", { encoding: "utf-8" }).trim();
        // Filter out our own PID
        pid = out.split("\n").find((p) => parseInt(p) !== process.pid) || null;
      }
      if (pid) {
        process.kill(parseInt(pid), "SIGTERM");
        console.log("✅ Stop signal sent to PID %s", pid);
      } else {
        console.log("⚠️  No running AI-Tunnel process found");
      }
    } catch {
      console.log("⚠️  No running AI-Tunnel process found");
    }
    break;

  case "help":
  default:
    console.log(`
🚇 AI-Tunnel v2 - API Tunnel Proxy

Usage:
  ai-tunnel init      Create config file
  ai-tunnel start     Start tunnel (default)
  ai-tunnel status    Show tunnel & channel status
  ai-tunnel stop      Stop running tunnel
  ai-tunnel help      Show this help

Config: tunnel.config.yaml
Proxy:  http://127.0.0.1:9000
Web UI: http://127.0.0.1:3000
`);
}
