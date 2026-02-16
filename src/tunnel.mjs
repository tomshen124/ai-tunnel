// src/tunnel.mjs - SSH 反向隧道管理

import { Client } from "ssh2";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

function expandHome(p) {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export async function createTunnelManager(config) {
  const { ssh, sites, settings } = config;

  function connect() {
    return new Promise((resolveP, reject) => {
      const conn = new Client();

      conn.on("ready", () => {
        console.log("  🔗 SSH connected");

        // 为每个站点建立反向隧道
        let pending = sites.length;
        for (const site of sites) {
          conn.forwardIn("127.0.0.1", site.remotePort, (err) => {
            if (err) {
              console.error(
                `  ❌ [${site.name}] Failed to forward port ${site.remotePort}: ${err.message}`
              );
            } else {
              console.log(
                `  🔗 [${site.name}] Remote :${site.remotePort} → local :${site.localPort}`
              );
            }
            if (--pending === 0) resolveP(conn);
          });
        }
      });

      // 处理反向隧道的入站连接
      conn.on("tcp connection", (info, accept, reject_) => {
        const site = sites.find((s) => s.remotePort === info.destPort);
        if (!site) {
          reject_();
          return;
        }

        const stream = accept();
        const { createConnection } = await_import("net");
        const local = createConnection(
          { port: site.localPort, host: "127.0.0.1" },
          () => {
            stream.pipe(local);
            local.pipe(stream);
          }
        );

        local.on("error", (e) => {
          console.error(`  ❌ [${site.name}] Local connection error: ${e.message}`);
          stream.end();
        });

        stream.on("error", (e) => {
          console.error(`  ❌ [${site.name}] Stream error: ${e.message}`);
          local.end();
        });
      });

      conn.on("error", (err) => {
        console.error(`  ❌ SSH error: ${err.message}`);
      });

      conn.on("close", () => {
        console.log(
          `  ⚠️  SSH disconnected. Reconnecting in ${settings.reconnectInterval}ms...`
        );
        setTimeout(() => {
          connect().catch(() => {});
        }, settings.reconnectInterval);
      });

      // 构建连接选项
      const connOpts = {
        host: ssh.host,
        port: ssh.port || 22,
        username: ssh.username || "root",
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      if (ssh.privateKeyPath) {
        try {
          connOpts.privateKey = readFileSync(expandHome(ssh.privateKeyPath));
        } catch (e) {
          throw new Error(`Cannot read SSH key: ${ssh.privateKeyPath} - ${e.message}`);
        }
      } else if (ssh.password) {
        connOpts.password = ssh.password;
      } else {
        throw new Error("SSH config needs either 'privateKeyPath' or 'password'");
      }

      conn.connect(connOpts);
    });
  }

  return connect();
}

// Dynamic import helper for net module
function await_import(mod) {
  return require(mod);
}
