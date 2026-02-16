// src/tunnel.mjs - SSH 反向隧道管理

import { Client } from "ssh2";
import { createConnection } from "net";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { log } from "./logger.mjs";

function expandHome(p) {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function createTunnelManager(config) {
  const { ssh, sites, settings } = config;
  let conn = null;
  let destroyed = false;

  function connect() {
    return new Promise((resolveP, reject) => {
      conn = new Client();

      conn.on("ready", () => {
        log("info", "SSH", "Connected to %s@%s:%d", ssh.username, ssh.host, ssh.port || 22);

        // 为每个站点建立反向隧道
        let pending = sites.length;
        let hasError = false;

        for (const site of sites) {
          conn.forwardIn("127.0.0.1", site.remotePort, (err) => {
            if (err) {
              log("error", site.name, "Failed to forward port %d: %s", site.remotePort, err.message);
              hasError = true;
            } else {
              log("info", site.name, "Remote :%d → local :%d", site.remotePort, site.localPort);
            }
            if (--pending === 0) {
              if (hasError && sites.length === pending) {
                reject(new Error("All port forwards failed"));
              } else {
                resolveP({ conn, shutdown });
              }
            }
          });
        }
      });

      // 处理反向隧道的入站连接
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
          stream.end();
        });

        stream.on("error", (e) => {
          log("error", site.name, "Stream error: %s", e.message);
          local.end();
        });

        stream.on("close", () => local.destroy());
        local.on("close", () => stream.destroy());
      });

      conn.on("error", (err) => {
        log("error", "SSH", "Error: %s", err.message);
      });

      conn.on("close", () => {
        if (destroyed) return;
        log("warn", "SSH", "Disconnected. Reconnecting in %dms...", settings.reconnectInterval);
        setTimeout(() => {
          if (!destroyed) {
            connect().catch((e) => {
              log("error", "SSH", "Reconnect failed: %s", e.message);
            });
          }
        }, settings.reconnectInterval);
      });

      // 构建连接选项
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
    if (conn) {
      conn.end();
      conn = null;
    }
  }

  return connect();
}
