// src/proxy.mjs - HTTP 反向代理

import { createServer } from "http";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";

export function createProxyServer(site) {
  const targetUrl = new URL(site.target);
  const isHttps = targetUrl.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const server = createServer((req, res) => {
    const opts = {
      hostname: targetUrl.hostname,
      port: isHttps ? 443 : 80,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.hostname,
        // 覆盖自定义 headers
        ...site.headers,
      },
    };

    // 移除可能冲突的 headers
    delete opts.headers["connection"];

    const proxy = requestFn(opts, (pRes) => {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.pipe(res);
    });

    proxy.on("error", (e) => {
      console.error(`  ❌ [${site.name}] Proxy error: ${e.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: `Proxy error: ${e.message}` }));
      }
    });

    req.pipe(proxy);
  });

  server.listen(site.localPort);

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        `  ❌ [${site.name}] Port ${site.localPort} already in use`
      );
    } else {
      console.error(`  ❌ [${site.name}] Server error: ${e.message}`);
    }
  });

  return server;
}
