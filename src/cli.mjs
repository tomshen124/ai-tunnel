#!/usr/bin/env node
// src/cli.mjs - CLI 入口

import { resolve } from "path";
import { existsSync, copyFileSync } from "fs";

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
      const src = resolve(
        import.meta.dirname,
        "..",
        "tunnel.config.example.yaml"
      );
      copyFileSync(src, dest);
      console.log("✅ Created tunnel.config.yaml — edit it with your settings.");
    }
    break;
  }

  case "status":
    console.log("TODO: Show tunnel status");
    break;

  case "stop":
    console.log("TODO: Stop running tunnel");
    break;

  case "help":
  default:
    console.log(`
🚇 AI-Tunnel - API Tunnel Proxy

Usage:
  ai-tunnel init      Create config file
  ai-tunnel start     Start tunnel (default)
  ai-tunnel status    Show tunnel status
  ai-tunnel stop      Stop running tunnel
  ai-tunnel help      Show this help
`);
}
