// src/index.mjs - AI-Tunnel 主入口

import { createProxyServer } from "./proxy.mjs";
import { createTunnelManager } from "./tunnel.mjs";
import { loadConfig } from "./config.mjs";
import { log, setLogLevel } from "./logger.mjs";

async function main() {
  console.log("\n🚇 AI-Tunnel\n");

  const config = loadConfig();
  setLogLevel(config.settings.logLevel);

  const cleanups = [];

  // 启动各站点的反代
  for (const site of config.sites) {
    const server = createProxyServer(site);
    cleanups.push(() => new Promise((r) => server.close(r)));
    log("info", site.name, "Proxy localhost:%d → %s", site.localPort, site.target);
  }

  // 建立 SSH 隧道
  let tunnelShutdown = null;
  if (config.ssh) {
    log("info", "SSH", "Connecting to %s:%d...", config.ssh.host, config.ssh.port || 22);
    try {
      const { shutdown } = await createTunnelManager(config);
      tunnelShutdown = shutdown;
      log("info", "SSH", "Tunnel established");
    } catch (e) {
      log("error", "SSH", "Failed to connect: %s", e.message);
      log("warn", "SSH", "Proxies are running locally but tunnel is not available");
    }
  }

  console.log("\n🚀 AI-Tunnel is running. Press Ctrl+C to stop.\n");

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}, shutting down...`);

    if (tunnelShutdown) tunnelShutdown();

    await Promise.all(cleanups.map((fn) => fn()));

    log("info", "System", "All connections closed. Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
