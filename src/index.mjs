// src/index.mjs - AI-Tunnel v2 main entry

import { loadConfig, watchConfig } from "./config.mjs";
import { createChannel } from "./channel.mjs";
import { createRouter } from "./router.mjs";
import { createRetryController } from "./retry.mjs";
import { createUnifiedProxy } from "./proxy.mjs";
import { createTunnelManager } from "./tunnel.mjs";
import { startHealthChecks } from "./health.mjs";
import { createApiServer } from "./api.mjs";
import { log, setLogLevel, subscribe } from "./logger.mjs";

async function main() {
  console.log("\n🚇 AI-Tunnel v2\n");

  // ─── Load config ───────────────────────────────────
  const config = loadConfig(process.env.TUNNEL_CONFIG || undefined);
  setLogLevel(config.settings.logLevel);

  // ─── Create channels ──────────────────────────────
  const channels = config.channels.map(createChannel);
  log("info", "System", "Loaded %d channel(s)", channels.length);

  // ─── Create router ────────────────────────────────
  const router = createRouter(channels, config.routes);

  // ─── Create retry controller ──────────────────────
  const retryCtrl = createRetryController(config.settings.retry);

  // ─── Start unified proxy ──────────────────────────
  const proxyServer = createUnifiedProxy(router, retryCtrl, {
    port: config.server.port,
    host: config.server.host,
  });
  log("info", "Proxy", "Unified entry on %s:%d", config.server.host, config.server.port);

  // ─── Start SSH tunnels (if configured) ────────────
  let tunnelShutdown = null;
  const tunnelChannels = channels.filter((ch) => ch.tunnel?.enabled);

  if (config.ssh && tunnelChannels.length > 0) {
    // Build a tunnel config compatible with existing tunnel.mjs
    const tunnelConfig = {
      ssh: config.ssh,
      sites: tunnelChannels.map((ch) => ({
        name: ch.name,
        localPort: ch.tunnel.localPort,
        remotePort: ch.tunnel.remotePort,
      })),
      settings: {
        reconnectInterval: config.settings.reconnectInterval,
      },
    };

    log("info", "SSH", "Connecting to %s:%d...", config.ssh.host, config.ssh.port || 22);
    try {
      const { shutdown } = await createTunnelManager(tunnelConfig);
      tunnelShutdown = shutdown;
      log("info", "SSH", "Tunnel established for %d channel(s)", tunnelChannels.length);
    } catch (e) {
      log("error", "SSH", "Failed to connect: %s", e.message);
      log("warn", "SSH", "Proxy is running but tunnels are not available");
    }
  }

  // ─── Start health checks ─────────────────────────
  let stopHealthChecks = startHealthChecks(channels);

  // ─── Start Web UI / API server ────────────────────
  let apiServer = null;
  if (config.server.ui?.enabled !== false) {
    apiServer = createApiServer(router, {
      port: config.server.ui?.port || 3000,
      host: config.server.ui?.host || "127.0.0.1",
    });
  }

  // ─── Hot reload ───────────────────────────────────
  if (config.settings.hotReload) {
    const unwatchFn = watchConfig(config._path, (newConfig) => {
      log("info", "Config", "Applying new configuration...");
      setLogLevel(newConfig.settings.logLevel);

      const newChannels = newConfig.channels.map(createChannel);
      router.update(newChannels, newConfig.routes);

      // Restart health checks
      stopHealthChecks();
      stopHealthChecks = startHealthChecks(newChannels);

      log("info", "Config", "Hot reload complete (%d channels)", newChannels.length);
    });

    // Handle config reload request from UI
    subscribe("config_reload_request", () => {
      try {
        const newConfig = loadConfig(config._path);
        log("info", "Config", "Manual reload triggered");
        setLogLevel(newConfig.settings.logLevel);

        const newChannels = newConfig.channels.map(createChannel);
        router.update(newChannels, newConfig.routes);
        stopHealthChecks();
        stopHealthChecks = startHealthChecks(newChannels);

        log("info", "Config", "Manual reload complete");
      } catch (e) {
        log("error", "Config", "Manual reload failed: %s", e.message);
      }
    });
  }

  // ─── Summary ──────────────────────────────────────
  console.log("");
  console.log("🚀 AI-Tunnel is running!");
  console.log(`   Proxy:  http://${config.server.host}:${config.server.port}`);
  if (apiServer) {
    console.log(`   Web UI: http://${config.server.ui?.host || "127.0.0.1"}:${config.server.ui?.port || 3000}`);
  }
  console.log(`   Channels: ${channels.length}`);
  if (tunnelChannels.length > 0) {
    console.log(`   Tunnels: ${tunnelChannels.length}`);
  }
  console.log("\n   Press Ctrl+C to stop.\n");

  // ─── Graceful shutdown ────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}, shutting down...`);

    stopHealthChecks();
    if (tunnelShutdown) tunnelShutdown();

    const closePromises = [];
    closePromises.push(new Promise((r) => proxyServer.close(r)));
    if (apiServer) closePromises.push(new Promise((r) => apiServer.close(r)));

    await Promise.all(closePromises);

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
