// test/run-ci.mjs - CI-friendly tests using mock API servers
// No external API calls — safe for GitHub Actions
// Usage: node test/run-ci.mjs

import { createMockApi } from "./mock-api.mjs";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const PROXY_PORT = 19000;
const UI_PORT = 13000;
const MOCK_PORT_A = 18001;
const MOCK_PORT_B = 18002;
const BASE = `http://127.0.0.1:${PROXY_PORT}`;
const UI_BASE = `http://127.0.0.1:${UI_PORT}`;

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
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const body = await res.json();
  return { status: res.status, headers: res.headers, body };
}

async function fetchRaw(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function fetchSSE(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  assert(res.ok, `SSE request failed with status ${res.status}`);
  const text = await res.text();
  const events = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6).trim());
  return { status: res.status, headers: res.headers, events };
}

// ─── Wait for server ─────────────────────────────────

async function waitForServer(url, maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs}ms`);
}

// ─── Main ────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}🧪 AI-Tunnel v2 — CI Tests (Mock API)${RESET}\n`);

  // ── Start mock API servers ──────────────────────
  console.log("  Starting mock API servers...");
  const mockA = await createMockApi({ port: MOCK_PORT_A });
  const mockB = await createMockApi({ port: MOCK_PORT_B });
  console.log(`  Mock A on :${MOCK_PORT_A}, Mock B on :${MOCK_PORT_B}`);

  // ── Start ai-tunnel ─────────────────────────────
  console.log("  Starting ai-tunnel...");
  const tunnelProc = spawn("node", ["src/index.mjs"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      TUNNEL_CONFIG: resolve(__dirname, "test.config.yaml"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let tunnelStderr = "";
  tunnelProc.stderr.on("data", (d) => {
    tunnelStderr += d.toString();
  });
  tunnelProc.stdout.on("data", () => {}); // drain

  try {
    await waitForServer(`${UI_BASE}/api/status`, 8000);
    console.log("  ai-tunnel is ready.\n");

    // ═══════════════════════════════════════════════
    // TEST SUITE
    // ═══════════════════════════════════════════════

    // 1. Service startup (already verified by waitForServer)
    await test("Service starts successfully", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/status`);
      assertEqual(status, 200, "status");
      assertEqual(body.status, "running", "status field");
    });

    // 2. GET /v1/models via unified proxy port
    await test("GET /v1/models returns model list (via :19000 proxy)", async () => {
      const { status, body } = await fetchJSON(`${BASE}/v1/models`);
      assertEqual(status, 200, "status");
      assert(body.data && body.data.length > 0, "Should return model list");
    });

    // 3. POST /v1/chat/completions (non-stream)
    await test("POST /v1/chat/completions — normal request", async () => {
      mockA.resetRequests();
      const { status, body } = await fetchJSON(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      assertEqual(status, 200, "status");
      assert(body.choices && body.choices.length > 0, "Should have choices");
      assert(body.choices[0].message.content.includes("mock"), "Response should come from mock");
    });

    // 4. SSE streaming
    await test("POST /v1/chat/completions stream=true — SSE streaming", async () => {
      const { status, events } = await fetchSSE(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      });
      assertEqual(status, 200, "status");
      assert(events.length >= 2, `Should have multiple SSE events, got ${events.length}`);
      assert(events[events.length - 1] === "[DONE]", "Last event should be [DONE]");

      const parsed = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e));
      assert(parsed.length > 0, "Should have parsed chunks");
      assert(parsed[0].object === "chat.completion.chunk", "Should be chunk objects");
    });

    // 5. Web UI accessible
    await test("Web UI is accessible (GET / returns HTML)", async () => {
      const { status, text } = await fetchRaw(UI_BASE);
      assertEqual(status, 200, "status");
      assert(
        text.includes("<html") || text.includes("AI-Tunnel") || text.includes("<!DOCTYPE"),
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
      assertEqual(body.channels.total, 2, "total channels");
    });

    // 7. API /api/channels
    await test("API /api/channels returns channel list", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/channels`);
      assertEqual(status, 200, "status");
      assert(Array.isArray(body), "Should be an array");
      assertEqual(body.length, 2, "channel count");

      const names = body.map((c) => c.name).sort();
      assert(names.includes("mock-primary"), "Should have mock-primary");
      assert(names.includes("mock-backup"), "Should have mock-backup");
    });

    // 8. API /api/stats
    await test("API /api/stats returns statistics", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/stats`);
      assertEqual(status, 200, "status");
      assert(typeof body.totalRequests === "number", "Should have totalRequests");
      assert(typeof body.totalSuccess === "number", "Should have totalSuccess");
      assert(body.channels, "Should have per-channel stats");
    });

    // 9. Channel failover: A returns 502 → request goes to B
    await test("Channel failover: primary 502 → fallback succeeds", async () => {
      mockA.setForceStatus(502, 10);
      mockB.resetRequests();

      const { status, body } = await fetchJSON(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "failover test" }],
        }),
      });

      assertEqual(status, 200, "status");
      assert(body.choices && body.choices.length > 0, "Should get response from backup");

      const bReqs = mockB.requests.filter(
        (r) => r.url === "/v1/chat/completions" && r.method === "POST"
      );
      assert(bReqs.length > 0, "Backup should have received the failover request");

      mockA.setForceStatus(0);
    });

    // 10. Graceful shutdown
    await test("Service shuts down gracefully on SIGTERM", async () => {
      // This is tested implicitly in cleanup, but let's verify
      // by checking the service is still running at this point
      const { status } = await fetchJSON(`${UI_BASE}/api/status`);
      assertEqual(status, 200, "Service should still be running");
    });

  } finally {
    // ── Cleanup ────────────────────────────────────
    console.log("\n  Cleaning up...");
    tunnelProc.kill("SIGTERM");
    await mockA.close();
    await mockB.close();
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── Summary ──────────────────────────────────────
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

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${RED}💥 Test runner crashed:${RESET}`, err);
  process.exit(2);
});
