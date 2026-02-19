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

      conn.on("ready", () => {
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

      // Handle inbound connections on forwarded ports
      conn.on("tcp connection", (info, accept, rejectStream) => {
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
      });

      conn.on("error", (err) => {
        log("error", "SSH", "Error: %s", err.message);
        // If we haven't resolved yet, reject the promise
        reject(err);
      });

      conn.on("close", () => {
        if (destroyed) return;
        log("warn", "SSH", "Disconnected. Reconnecting in %dms...", settings.reconnectInterval);
        reconnectTimer = setTimeout(() => {
          if (!destroyed) {
            connect().catch((e) => {
              log("error", "SSH", "Reconnect failed: %s", e.message);
            });
          }
        }, settings.reconnectInterval);
      });

      // Build connection options
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
          reject(new Error(`Cannot read SSH key: ${ssh.privateKeyPath} - ${e.message}`));
          return;
        }
      } else if (ssh.password) {
        connOpts.password = ssh.password;
      } else {
        reject(new Error("SSH config needs either 'privateKeyPath' or 'password'"));
        return;
      }

      conn.connect(connOpts);
    });
  }

  function shutdown() {
    destroyed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (conn) {
      conn.end();
      conn = null;
    }
    log("info", "SSH", "Tunnel shut down");
  }

  return connect();
}
