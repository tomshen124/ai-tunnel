// src/proxy.mjs - HTTP 反向代理（支持 SSE 流式响应）

import { createServer } from "http";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { log } from "./logger.mjs";

export function createProxyServer(site) {
  const targetUrl = new URL(site.target);
  const isHttps = targetUrl.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const server = createServer((req, res) => {
    const startTime = Date.now();
    const reqId = Math.random().toString(36).slice(2, 8);

    log("debug", site.name, "[%s] %s %s", reqId, req.method, req.url);

    const opts = {
      hostname: targetUrl.hostname,
      port: isHttps ? 443 : (targetUrl.port || 80),
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.hostname,
        // 覆盖自定义 headers
        ...site.headers,
      },
    };

    // 移除 hop-by-hop headers
    delete opts.headers["connection"];
    delete opts.headers["keep-alive"];
    delete opts.headers["transfer-encoding"];

    const proxy = requestFn(opts, (pRes) => {
      const elapsed = Date.now() - startTime;
      log("info", site.name, "[%s] %s %s → %d (%dms)",
        reqId, req.method, req.url, pRes.statusCode, elapsed);

      // 透传所有 headers，保持 SSE 流式响应
      const headers = { ...pRes.headers };

      // 确保 SSE 不被缓冲
      if (headers["content-type"]?.includes("text/event-stream")) {
        headers["cache-control"] = "no-cache";
        headers["x-accel-buffering"] = "no";
      }

      res.writeHead(pRes.statusCode, headers);

      // 直接 pipe，支持流式（SSE/chunked）
      pRes.pipe(res);

      pRes.on("error", (e) => {
        log("error", site.name, "[%s] Response stream error: %s", reqId, e.message);
        res.end();
      });
    });

    proxy.on("error", (e) => {
      const elapsed = Date.now() - startTime;
      log("error", site.name, "[%s] %s %s → ERROR (%dms): %s",
        reqId, req.method, req.url, elapsed, e.message);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Proxy error: ${e.message}`, type: "proxy_error" } }));
      }
    });

    // 确保请求体也是流式转发
    req.pipe(proxy);

    req.on("error", (e) => {
      log("error", site.name, "[%s] Request error: %s", reqId, e.message);
      proxy.destroy();
    });
  });

  server.listen(site.localPort, "127.0.0.1");

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log("error", site.name, "Port %d already in use", site.localPort);
    } else {
      log("error", site.name, "Server error: %s", e.message);
    }
  });

  return server;
}
