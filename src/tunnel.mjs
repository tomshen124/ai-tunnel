// src/tunnel.mjs - SSH reverse tunnel manager

import { Client } from "ssh2";
import { createConnection } from "net";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { log } from "./logger.mjs";

function expandHome(p) {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

export function createTunnelManager(config) {
  const { ssh, sites, settings } = config;
  let conn = null;
  let destroyed = false;
  let reconnectTimer = null;

  function connect() {
    return new Promise((resolveP, reject) => {
      conn = new Client();
      let settled = false;

      conn.on("ready", () => {
        settled = true;
        log("info", "SSH", "Connected to %s@%s:%d", ssh.username || "root", ssh.host, ssh.port || 22);

        let pending = sites.length;
        if (pending === 0) {
          resolveP({ conn, shutdown });
          return;
        }

        for (const site of sites) {
          conn.forwardIn("127.0.0.1", site.remotePort, (err) => {
            if (err) {
              log("error", site.name, "Failed to forward port %d: %s", site.remotePort, err.message);
            } else {
              log("info", site.name, "Remote :%d → local :%d", site.remotePort, site.localPort);
            }
            if (--pending === 0) resolveP({ conn, shutdown });
          });
        }
      });

      conn.on("tcp connection", handleTcpConnection);

      conn.on("error", (err) => {
        log("error", "SSH", "Error: %s", err.message);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      conn.on("close", () => {
        if (destroyed) return;
        log("warn", "SSH", "Disconnected. Reconnecting in %dms...", settings.reconnectInterval);
        reconnectTimer = setTimeout(() => {
          if (!destroyed) reconnect();
        }, settings.reconnectInterval);
      });

      const connOpts = buildConnOpts();
      if (!connOpts) {
        reject(new Error("Invalid SSH configuration"));
        return;
      }
      conn.connect(connOpts);
    });
  }

  // Reconnect without creating a new promise chain — fire-and-forget with logging
  function reconnect() {
    conn = new Client();
    let settled = false;

    conn.on("ready", () => {
      settled = true;
      log("info", "SSH", "Reconnected to %s@%s:%d", ssh.username || "root", ssh.host, ssh.port || 22);

      // First cancel any stale forwardIn bindings, then re-establish
      let pending = sites.length;
      if (pending === 0) return;

      // Kill any stale sshd processes holding our ports on the remote server
      const ports = sites.map(s => s.remotePort);
      const killCmd = ports.map(p =>
        `fuser -k ${p}/tcp 2>/dev/null; sleep 0.5`
      ).join("; ");

      conn.exec(killCmd, (execErr, stream) => {
        if (execErr) {
          log("warn", "SSH", "Could not clean stale ports: %s", execErr.message);
        }
        if (stream) {
          stream.on("close", () => {
            forwardAllSites();
          });
          stream.resume(); // drain the stream
        } else {
          forwardAllSites();
        }
      });

      function forwardAllSites() {
        for (const site of sites) {
          conn.forwardIn("127.0.0.1", site.remotePort, (err) => {
            if (err) {
              log("error", site.name, "Failed to forward port %d: %s", site.remotePort, err.message);
            } else {
              log("info", site.name, "Remote :%d → local :%d (reconnected)", site.remotePort, site.localPort);
            }
          });
        }
      }
    });

    conn.on("tcp connection", handleTcpConnection);

    conn.on("error", (err) => {
      log("error", "SSH", "Reconnect error: %s", err.message);
    });

    conn.on("close", () => {
      if (destroyed) return;
      log("warn", "SSH", "Disconnected again. Reconnecting in %dms...", settings.reconnectInterval);
      reconnectTimer = setTimeout(() => {
        if (!destroyed) reconnect();
      }, settings.reconnectInterval);
    });

    const connOpts = buildConnOpts();
    if (!connOpts) return;
    conn.connect(connOpts);
  }

  // Shared TCP connection handler
  function handleTcpConnection(info, accept, rejectStream) {
    const site = sites.find((s) => s.remotePort === info.destPort);
    if (!site) {
      rejectStream();
      return;
    }

    const stream = accept();
    const local = createConnection(
      { port: site.localPort, host: "127.0.0.1" },
      () => {
        stream.pipe(local);
        local.pipe(stream);
      }
    );

    local.on("error", (e) => {
      log("error", site.name, "Local connection error: %s", e.message);
      stream.destroy();
    });

    stream.on("error", (e) => {
      log("error", site.name, "Stream error: %s", e.message);
      local.destroy();
    });

    stream.on("close", () => local.destroy());
    local.on("close", () => stream.destroy());
  }

  // Build SSH connection options
  function buildConnOpts() {
    const connOpts = {
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.username || "root",
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      readyTimeout: 15000,
    };

    if (ssh.privateKeyPath) {
      try {
        connOpts.privateKey = readFileSync(expandHome(ssh.privateKeyPath));
      } catch (e) {
        log("error", "SSH", "Cannot read SSH key: %s - %s", ssh.privateKeyPath, e.message);
        return null;
      }
    } else if (ssh.password) {
      connOpts.password = ssh.password;
    } else {
      log("error", "SSH", "SSH config needs either 'privateKeyPath' or 'password'");
      return null;
    }
    return connOpts;
  }

  function shutdown() {
    destroyed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (conn) {
      // Give SSH 2s to close gracefully, then force destroy
      const forceTimer = setTimeout(() => {
        if (conn) { try { conn.destroy(); } catch {} }
      }, 2000);
      conn.on("close", () => clearTimeout(forceTimer));
      conn.end();
      conn = null;
    }
    log("info", "SSH", "Tunnel shut down");
  }

  return connect();
}
