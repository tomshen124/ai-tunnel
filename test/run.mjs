// test/run.mjs - Automated API-level tests for ai-tunnel v2
// No test framework — pure Node.js
// Usage: node test/run.mjs
//
// Uses a real API endpoint (wzw.pp.ua) for integration tests
// and an unreachable endpoint (127.0.0.1:1) for failover tests.

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ─── Ports (use high ports to avoid conflicts) ──────
const PROXY_PORT = 19000;
const UI_PORT = 13000;
const BASE = `http://127.0.0.1:${PROXY_PORT}`;
const UI_BASE = `http://127.0.0.1:${UI_PORT}`;

// ─── Real API config ────────────────────────────────
const REAL_API_TARGET = "https://wzw.pp.ua";
const REAL_API_KEY = "sk-he1i2RCiwFRJTFanih1tgEJxBOhKJsLLMaNxTHQI2rK32Jkf";
const TEST_MODEL = "claude-haiku-4-5-20251001";

// ─── Test runner ─────────────────────────────────────

const results = [];
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  ${GREEN}✅ PASS${RESET}: ${name}`);
  } catch (err) {
    results.push({ name, pass: false, reason: err.message });
    console.log(`  ${RED}❌ FAIL${RESET}: ${name}`);
    console.log(`          ${RED}${err.message}${RESET}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(actual, expected, label = "") {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

// ─── HTTP helpers ────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
  const body = await res.json();
  return { status: res.status, headers: res.headers, body };
}

async function fetchRaw(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function fetchSSE(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
  assert(res.ok, `SSE request failed with status ${res.status}`);
  const text = await res.text();
  const events = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6).trim());
  return { status: res.status, headers: res.headers, events };
}

// ─── Wait for server ─────────────────────────────────

async function waitForServer(url, maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs}ms`);
}

// ─── Generate test config ────────────────────────────

function generateTestConfig() {
  return `# Auto-generated test config for ai-tunnel
server:
  port: ${PROXY_PORT}
  host: "127.0.0.1"
  ui:
    enabled: true
    port: ${UI_PORT}
    host: "127.0.0.1"

channels:
  - name: "real-api"
    target: "${REAL_API_TARGET}"
    keys:
      - "${REAL_API_KEY}"
    keyStrategy: "round-robin"
    weight: 10
    tunnel:
      enabled: false
    healthCheck:
      path: "/v1/models"
      intervalMs: 600000
      timeoutMs: 5000

  - name: "dead-channel"
    target: "http://127.0.0.1:1"
    keys:
      - "sk-dead-key-0001"
    weight: 20
    fallback: false
    tunnel:
      enabled: false
    healthCheck:
      path: "/v1/models"
      intervalMs: 600000
      timeoutMs: 2000

routes:
  - path: "/v1/**"
    channels: ["real-api"]
    strategy: "priority"

settings:
  reconnectInterval: 5000
  logLevel: "warn"
  hotReload: false
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "fixed"
    baseDelayMs: 200
    maxDelayMs: 1000
`;
}

function generateFailoverConfig() {
  // Config where dead-channel is primary (high weight), real-api is fallback
  return `# Auto-generated failover test config
server:
  port: ${PROXY_PORT}
  host: "127.0.0.1"
  ui:
    enabled: true
    port: ${UI_PORT}
    host: "127.0.0.1"

channels:
  - name: "dead-channel"
    target: "http://127.0.0.1:1"
    keys:
      - "sk-dead-key-0001"
    weight: 20
    tunnel:
      enabled: false
    healthCheck:
      path: "/v1/models"
      intervalMs: 600000
      timeoutMs: 2000

  - name: "real-api"
    target: "${REAL_API_TARGET}"
    keys:
      - "${REAL_API_KEY}"
    keyStrategy: "round-robin"
    weight: 5
    fallback: true
    tunnel:
      enabled: false
    healthCheck:
      path: "/v1/models"
      intervalMs: 600000
      timeoutMs: 5000

routes:
  - path: "/v1/**"
    channels: ["dead-channel", "real-api"]
    strategy: "priority"

settings:
  reconnectInterval: 5000
  logLevel: "warn"
  hotReload: false
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "fixed"
    baseDelayMs: 200
    maxDelayMs: 1000
`;
}

// ─── Start/stop ai-tunnel process ────────────────────

function startTunnel(configPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["src/index.mjs"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        TUNNEL_CONFIG: configPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.stdout.on("data", () => {}); // drain

    proc.on("error", (err) => reject(err));

    resolve({ proc, getStderr: () => stderr });
  });
}

async function stopTunnel(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  // Force kill if still alive
  try {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  } catch { /* already dead */ }
  await new Promise((r) => setTimeout(r, 300));
}

// ─── Main ────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}🧪 AI-Tunnel v2 — Automated Tests${RESET}\n`);
  console.log(`   Real API: ${REAL_API_TARGET}`);
  console.log(`   Model:    ${TEST_MODEL}\n`);

  // ═══════════════════════════════════════════════════
  // PHASE 1: Normal operation tests (real API)
  // ═══════════════════════════════════════════════════

  console.log(`${BOLD}── Phase 1: Service & API Tests ──${RESET}\n`);

  const configPath = resolve(__dirname, ".test.config.yaml");
  writeFileSync(configPath, generateTestConfig());

  const { proc: tunnelProc } = await startTunnel(configPath);

  try {
    // 1. Service startup
    await test("Service starts and becomes ready", async () => {
      await waitForServer(`${UI_BASE}/api/status`, 15000);
    });

    // 2. GET /v1/models via proxy port
    await test("GET /v1/models returns model list (via :9000 proxy)", async () => {
      const { status, body } = await fetchJSON(`${BASE}/v1/models`);
      assertEqual(status, 200, "status");
      assert(body.data && Array.isArray(body.data), "Should return data array");
      assert(body.data.length > 0, "Should have at least one model");
    });

    // 3. POST /v1/chat/completions (non-stream)
    await test("POST /v1/chat/completions — normal request", async () => {
      const { status, body } = await fetchJSON(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: TEST_MODEL,
          messages: [{ role: "user", content: "Reply with exactly: hello" }],
          max_tokens: 20,
        }),
      });
      assertEqual(status, 200, "status");
      assert(body.choices && body.choices.length > 0, "Should have choices");
      assert(body.choices[0].message, "Choice should have message");
      assert(typeof body.choices[0].message.content === "string", "Message content should be string");
    });

    // 4. POST /v1/chat/completions stream=true SSE
    await test("POST /v1/chat/completions stream=true — SSE streaming", async () => {
      const { status, events } = await fetchSSE(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: TEST_MODEL,
          messages: [{ role: "user", content: "Reply with exactly: hi" }],
          stream: true,
          max_tokens: 10,
        }),
      });
      assertEqual(status, 200, "status");
      assert(events.length >= 2, `Should have multiple SSE events, got ${events.length}`);
      assert(events[events.length - 1] === "[DONE]", "Last event should be [DONE]");

      // Parse intermediate events
      const parsed = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e));
      assert(parsed.length > 0, "Should have parsed chunks");
      assert(parsed[0].object === "chat.completion.chunk", "Should be chunk objects");
    });

    // 5. Web UI accessible
    await test("Web UI is accessible (GET / returns HTML)", async () => {
      const { status, text } = await fetchRaw(UI_BASE);
      assertEqual(status, 200, "status");
      assert(
        text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("AI-Tunnel"),
        "Should return HTML content"
      );
    });

    // 6. API /api/status
    await test("API /api/status returns valid status", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/status`);
      assertEqual(status, 200, "status");
      assertEqual(body.status, "running", "status field");
      assert(typeof body.uptime === "number", "uptime should be a number");
      assert(body.channels, "Should have channels info");
    });

    // 7. API /api/channels
    await test("API /api/channels returns channel list", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/channels`);
      assertEqual(status, 200, "status");
      assert(Array.isArray(body), "Should be an array");
      assert(body.length >= 1, "Should have at least one channel");

      for (const ch of body) {
        assert(ch.name, "Channel should have name");
        assert(ch.target, "Channel should have target");
      }
    });

    // 8. API /api/stats
    await test("API /api/stats returns statistics", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/stats`);
      assertEqual(status, 200, "status");
      assert(typeof body.totalRequests === "number", "Should have totalRequests");
      assert(typeof body.totalSuccess === "number", "Should have totalSuccess");
      assert(body.channels, "Should have per-channel stats");
    });

  } finally {
    await stopTunnel(tunnelProc);
  }

  // ═══════════════════════════════════════════════════
  // PHASE 2: Failover test
  // ═══════════════════════════════════════════════════

  console.log(`\n${BOLD}── Phase 2: Failover Test ──${RESET}\n`);

  const failoverConfigPath = resolve(__dirname, ".test.failover.config.yaml");
  writeFileSync(failoverConfigPath, generateFailoverConfig());

  const { proc: failoverProc } = await startTunnel(failoverConfigPath);

  try {
    await waitForServer(`${UI_BASE}/api/status`, 15000);

    // 9. Failover: dead channel → real API
    await test("Failover: dead channel (127.0.0.1:1) → real API succeeds", async () => {
      const { status, body } = await fetchJSON(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: TEST_MODEL,
          messages: [{ role: "user", content: "Reply with exactly: failover-ok" }],
          max_tokens: 20,
        }),
      });
      assertEqual(status, 200, "status");
      assert(body.choices && body.choices.length > 0, "Should have choices after failover");
      assert(
        typeof body.choices[0].message.content === "string",
        "Should have valid response content"
      );
    });

    // 10. Failover SSE streaming also works
    await test("Failover: SSE streaming through fallback channel", async () => {
      const { status, events } = await fetchSSE(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: TEST_MODEL,
          messages: [{ role: "user", content: "Reply with exactly: stream-ok" }],
          stream: true,
          max_tokens: 10,
        }),
      });
      assertEqual(status, 200, "status");
      assert(events.length >= 2, "Should have SSE events after failover");
      assert(events[events.length - 1] === "[DONE]", "Last event should be [DONE]");
    });

  } finally {
    await stopTunnel(failoverProc);
  }

  // ═══════════════════════════════════════════════════
  // PHASE 3: Service shutdown test
  // ═══════════════════════════════════════════════════

  console.log(`\n${BOLD}── Phase 3: Service Lifecycle ──${RESET}\n`);

  await test("Service shuts down gracefully on SIGTERM", async () => {
    writeFileSync(configPath, generateTestConfig());
    const { proc } = await startTunnel(configPath);
    await waitForServer(`${UI_BASE}/api/status`, 15000);

    // Send SIGTERM
    proc.kill("SIGTERM");

    // Wait for exit
    const exitCode = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve(-1);
      }, 5000);
      proc.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    assertEqual(exitCode, 0, "exit code");

    // Verify port is released
    await new Promise((r) => setTimeout(r, 300));
    try {
      await fetch(`${UI_BASE}/api/status`, { signal: AbortSignal.timeout(1000) });
      throw new Error("Server should not be reachable after shutdown");
    } catch (err) {
      // Expected: connection refused or timeout
      assert(
        err.message.includes("fetch failed") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("aborted") ||
        err.message.includes("Server should not"),
        `Unexpected error: ${err.message}`
      );
      if (err.message.includes("Server should not")) throw err;
    }
  });

  // ═══════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  console.log("\n" + "═".repeat(50));
  if (failed === 0) {
    console.log(`  ${GREEN}${BOLD}All ${total} tests passed!${RESET}`);
  } else {
    console.log(`  Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET} (${total} total)`);
  }
  console.log("═".repeat(50));

  if (failed > 0) {
    console.log(`\n  ${RED}Failed tests:${RESET}`);
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`    ${RED}❌ ${r.name}${RESET}`);
      console.log(`       ${r.reason}`);
    }
    console.log("");
  }

  // Cleanup temp config files
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(configPath);
    unlinkSync(failoverConfigPath);
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${RED}💥 Test runner crashed:${RESET}`, err);
  process.exit(2);
});
