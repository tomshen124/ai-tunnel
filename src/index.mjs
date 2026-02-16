// src/index.mjs - AI-Tunnel 主入口
// TODO: 实现完整功能

import { readFileSync } from "fs";
import { resolve } from "path";
import { createProxyServer } from "./proxy.mjs";
import { createTunnelManager } from "./tunnel.mjs";
import { loadConfig } from "./config.mjs";

async function main() {
  console.log("🚇 AI-Tunnel starting...\n");

  const config = loadConfig();

  // 启动各站点的反代
  const proxies = [];
  for (const site of config.sites) {
    const proxy = createProxyServer(site);
    proxies.push(proxy);
    console.log(
      `  ✅ [${site.name}] localhost:${site.localPort} → ${site.target}`
    );
  }

  // 建立 SSH 隧道
  if (config.ssh) {
    console.log(`\n🔗 Connecting SSH tunnel to ${config.ssh.host}...`);
    const tunnel = await createTunnelManager(config);
    console.log("  ✅ SSH tunnel established");
    console.log("\n📋 Remote port mappings:");
    for (const site of config.sites) {
      console.log(
        `  VPS localhost:${site.remotePort} → ${site.name} (${site.target})`
      );
    }
  }

  console.log("\n🚀 AI-Tunnel is running. Press Ctrl+C to stop.\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
