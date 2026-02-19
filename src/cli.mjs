#!/usr/bin/env node
// src/cli.mjs - CLI entry point (v2)

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, copyFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0] || "start";

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
      const res = await fetch("http://127.0.0.1:3000/api/status");
      const data = await res.json();
      const h = Math.floor(data.uptime / 3600);
      const m = Math.floor((data.uptime % 3600) / 60);
      console.log(`🚇 AI-Tunnel ${data.version}`);
      console.log(`   Status:   ${data.status}`);
      console.log(`   Uptime:   ${h}h ${m}m`);
      console.log(`   Channels: ${data.channels.healthy}/${data.channels.total} healthy`);

      const chRes = await fetch("http://127.0.0.1:3000/api/channels");
      const channels = await chRes.json();
      console.log("");
      for (const ch of channels) {
        const icon = !ch.enabled ? "⏸" : ch.health === "healthy" ? "🟢" : ch.health === "unhealthy" ? "🔴" : "🟡";
        const latency = ch.latency != null ? `${ch.latency}ms` : "--";
        console.log(`   ${icon} ${ch.name.padEnd(20)} ${latency.padStart(6)}  keys: ${ch.keys.alive}/${ch.keys.total}  reqs: ${ch.stats.totalRequests}`);
      }
    } catch {
      console.log("❌ AI-Tunnel is not running (cannot connect to :3000)");
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
        // Windows: use wmic/tasklist to find node process running index.mjs
        const out = execSync(
          'wmic process where "CommandLine like \'%index.mjs%\' and Name=\'node.exe\'" get ProcessId /format:list',
          { encoding: "utf-8" }
        ).trim();
        const match = out.match(/ProcessId=(\d+)/);
        pid = match ? match[1] : null;
      } else {
        // Unix (Linux/macOS): use pgrep
        pid = execSync("pgrep -f 'node.*index.mjs'", { encoding: "utf-8" }).trim();
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
