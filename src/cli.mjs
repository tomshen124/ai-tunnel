#!/usr/bin/env node
// src/cli.mjs - CLI entry point

import { resolve } from "path";
import { existsSync, copyFileSync } from "fs";

const args = process.argv.slice(2);
const command = args[0] || "start";

function getArg(flag) {
  const i = args.indexOf(flag);
  if (i !== -1 && i + 1 < args.length) return args[i + 1];
  return null;
}

switch (command) {
  case "start": {
    // Allow overriding config path for service usage
    const configPath = getArg("--config") || process.env.TUNNEL_CONFIG;
    if (configPath) process.env.TUNNEL_CONFIG = configPath;
    await import("./index.mjs");
    break;
  }

  case "init": {
    const dest = resolve(process.cwd(), "tunnel.config.yaml");
    if (existsSync(dest)) {
      console.log("⚠️  tunnel.config.yaml already exists. Skipping.");
    } else {
      const src = resolve(import.meta.dirname, "..", "tunnel.config.example.yaml");
      copyFileSync(src, dest);
      console.log("✅ Created tunnel.config.yaml — edit it with your settings.");
    }
    break;
  }

  case "status":
    try {
      const res = await fetch("http://127.0.0.1:3000/api/status");
      const data = await res.json();
      const h = Math.floor(data.uptime / 3600);
      const m = Math.floor((data.uptime % 3600) / 60);
      console.log(`🚇 AI-Tunnel ${data.version}`);
      console.log(`   Status:   ${data.status}`);
      console.log(`   Uptime:   ${h}h ${m}m`);
      console.log(
        `   Channels: ${data.channels.healthy}/${data.channels.total} healthy`
      );

      const chRes = await fetch("http://127.0.0.1:3000/api/channels");
      const channels = await chRes.json();
      console.log("");
      for (const ch of channels) {
        const icon = !ch.enabled
          ? "⏸"
          : ch.health === "healthy"
          ? "🟢"
          : ch.health === "unhealthy"
          ? "🔴"
          : "🟡";
        const latency = ch.latency != null ? `${ch.latency}ms` : "--";
        console.log(
          `   ${icon} ${ch.name.padEnd(20)} ${latency.padStart(6)}  keys: ${ch.keys.alive}/${ch.keys.total}  reqs: ${ch.stats.totalRequests}`
        );
      }
    } catch {
      console.log("❌ AI-Tunnel is not running (cannot connect to :3000)");
    }
    break;

  case "stop":
    try {
      // Send SIGTERM to the running process
      console.log("🛑 Sending stop signal...");
      // Try to find the process
      const { execSync } = await import("child_process");
      const pid = execSync("pgrep -f 'node.*index.mjs'", {
        encoding: "utf-8",
      }).trim();
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
🚇 AI-Tunnel - API Tunnel Proxy

Usage:
  ai-tunnel init                  Create config file (./tunnel.config.yaml)
  ai-tunnel start [--config PATH] Start tunnel (foreground)
  ai-tunnel status                Show tunnel & channel status
  ai-tunnel stop                  Stop running tunnel (best-effort)
  ai-tunnel help                  Show this help

Env:
  TUNNEL_CONFIG                   Config file path (alternative to --config)

Default ports (from config defaults):
  Proxy:  http://127.0.0.1:9000
  Web UI: http://127.0.0.1:3000
`);
}
