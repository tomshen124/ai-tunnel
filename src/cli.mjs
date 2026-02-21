#!/usr/bin/env node
// src/cli.mjs - CLI entry point (v2)

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, copyFileSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0] || "help";
const flags = new Set(args.slice(1));

// ─── PID / log paths ────────────────────────────────
const DATA_DIR = resolve(homedir(), ".ai-tunnel");
const PID_FILE = resolve(DATA_DIR, "ai-tunnel.pid");
const LOG_FILE = resolve(DATA_DIR, "ai-tunnel.log");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Read UI port/host from config file (best-effort).
 */
function getUiAddress() {
  const configPath = process.env.TUNNEL_CONFIG || resolve(process.cwd(), "tunnel.config.yaml");
  try {
    const raw = readFileSync(configPath, "utf-8");
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

/**
 * Read saved PID from file, return null if stale or missing.
 */
function readPid() {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    // Check if process is alive
    process.kill(pid, 0);
    return pid;
  } catch {
    // PID file missing, unreadable, or process dead — clean up
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    return null;
  }
}

function writePid(pid) {
  ensureDataDir();
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

function removePid() {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// ─── Commands ────────────────────────────────────────

switch (command) {
  case "start": {
    const foreground = flags.has("--foreground") || flags.has("-f");
    const configArgIdx = args.indexOf("--config");
    if (configArgIdx !== -1 && args[configArgIdx + 1]) {
      process.env.TUNNEL_CONFIG = args[configArgIdx + 1];
    }

    if (foreground) {
      // Run in foreground (same as old behavior)
      await import("./index.mjs");
      break;
    }

    // Daemon mode
    const existing = readPid();
    if (existing) {
      console.log(`⚠️  AI-Tunnel is already running (PID ${existing})`);
      console.log(`   Use 'ai-tunnel stop' to stop it, or 'ai-tunnel restart' to restart.`);
      process.exit(1);
    }

    ensureDataDir();
    const { openSync } = await import("fs");
    const logFd = openSync(LOG_FILE, "a");
    const entryFile = resolve(__dirname, "index.mjs");

    const child = spawn(process.execPath, [entryFile], {
      cwd: process.cwd(),
      env: { ...process.env },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    writePid(child.pid);
    child.unref();

    const ui = getUiAddress();
    console.log(`🚇 AI-Tunnel started (PID ${child.pid})`);
    console.log(`   Proxy:  http://127.0.0.1:${ui.port === 3000 ? '9000' : '9000'}`);
    console.log(`   Web UI: http://${ui.host}:${ui.port}`);
    console.log(`   Logs:   ${LOG_FILE}`);
    process.exit(0);
  }

  case "stop": {
    const pid = readPid();
    if (!pid) {
      console.log("⚠️  AI-Tunnel is not running");
      process.exit(0);
    }

    console.log(`🛑 Stopping AI-Tunnel (PID ${pid})...`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      console.log("⚠️  Process already gone");
      removePid();
      process.exit(0);
    }

    // Wait for process to exit (up to 8s)
    let gone = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
      } catch {
        gone = true;
        break;
      }
    }

    if (!gone) {
      console.log("⚠️  Force killing...");
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }

    removePid();
    console.log("✅ AI-Tunnel stopped");
    break;
  }

  case "restart": {
    const pid = readPid();
    if (pid) {
      console.log(`🔄 Restarting AI-Tunnel (PID ${pid})...`);
      try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
      // Wait for exit
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try { process.kill(pid, 0); } catch { break; }
      }
      removePid();
    }

    // Re-exec start command
    const { execSync } = await import("child_process");
    execSync(`"${process.execPath}" "${resolve(__dirname, 'cli.mjs')}" start`, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    break;
  }

  case "status": {
    const pid = readPid();
    if (!pid) {
      console.log("⬚ AI-Tunnel is not running");
      process.exit(1);
    }

    try {
      const ui = getUiAddress();
      const uiBase = `http://${ui.host}:${ui.port}`;
      const res = await fetch(`${uiBase}/api/status`);
      const data = await res.json();
      const h = Math.floor(data.uptime / 3600);
      const m = Math.floor((data.uptime % 3600) / 60);
      console.log(`🚇 AI-Tunnel ${data.version} (PID ${pid})`);
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
      console.log("");
      console.log(`   Web UI: http://${ui.host}:${ui.port}`);
      console.log(`   Logs:   ${LOG_FILE}`);
    } catch {
      console.log(`⚠️  AI-Tunnel process exists (PID ${pid}) but Web UI is not responding`);
    }
    break;
  }

  case "logs": {
    const follow = flags.has("-f") || flags.has("--follow");
    const lines = parseInt(args.find(a => /^\d+$/.test(a))) || 50;

    if (!existsSync(LOG_FILE)) {
      console.log("⚠️  No log file found. Start AI-Tunnel first.");
      process.exit(1);
    }

    if (follow) {
      const { spawn: spawnProc } = await import("child_process");
      const tail = spawnProc("tail", ["-f", "-n", String(lines), LOG_FILE], { stdio: "inherit" });
      tail.on("exit", (code) => process.exit(code || 0));
    } else {
      const { execSync } = await import("child_process");
      try {
        const out = execSync(`tail -n ${lines} "${LOG_FILE}"`, { encoding: "utf-8" });
        process.stdout.write(out);
      } catch {
        console.log(readFileSync(LOG_FILE, "utf-8"));
      }
    }
    break;
  }

  case "init": {
    ensureDataDir();
    const dest = resolve(DATA_DIR, "tunnel.config.yaml");
    if (existsSync(dest)) {
      console.log(`⚠️  Config already exists: ${dest}`);
    } else {
      const src = resolve(__dirname, "..", "tunnel.config.example.yaml");
      copyFileSync(src, dest);
      console.log(`✅ Created config: ${dest}`);
      console.log(`   Edit it, then run 'ai-tunnel start'`);
    }
    break;
  }

  case "help":
  case "--help":
  case "-h":
  default:
    console.log(`
🚇 AI-Tunnel v2 - API Tunnel Proxy

Usage:
  ai-tunnel start          Start in background (daemon mode)
  ai-tunnel start -f       Start in foreground
  ai-tunnel stop           Stop the running daemon
  ai-tunnel restart        Restart the daemon
  ai-tunnel status         Show tunnel & channel status
  ai-tunnel logs           Show recent logs
  ai-tunnel logs -f        Follow logs (live)
  ai-tunnel init           Create config file
  ai-tunnel help           Show this help

Files:
  Config:  ./tunnel.config.yaml
  Logs:    ${LOG_FILE}
  PID:     ${PID_FILE}

Web UI:  http://127.0.0.1:3000 (when running)
`);
}
