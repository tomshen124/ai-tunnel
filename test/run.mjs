// test/run.mjs - Automated API-level tests for ai-tunnel v2
// No test framework — pure Node.js
// Usage: node test/run.mjs

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

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    results.push({ name, pass: false, reason: err.message });
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`          ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(actual, expected, label = "") {
  if (actual !== expected) {
    throw new Error(`${label ? label + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── HTTP helpers ────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json();
  return { status: res.status, headers: res.headers, body };
}

async function fetchRaw(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function fetchSSE(url, opts = {}) {
  const res = await fetch(url, opts);
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
      const res = await fetch(url);
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
  console.log("\n🧪 AI-Tunnel v2 — Automated Tests\n");

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

  // Collect stderr for debugging
  let tunnelStderr = "";
  tunnelProc.stderr.on("data", (d) => { tunnelStderr += d.toString(); });
  tunnelProc.stdout.on("data", () => {}); // drain

  try {
    await waitForServer(`${UI_BASE}/api/status`, 8000);
    console.log("  ai-tunnel is ready.\n");

    // ═══════════════════════════════════════════════
    // TEST SUITE
    // ═══════════════════════════════════════════════

    // 1. Proxy port accessible
    await test("Proxy port is accessible", async () => {
      const { status, body } = await fetchJSON(`${BASE}/v1/models`);
      assertEqual(status, 200, "status");
      assert(body.data && body.data.length > 0, "Should return model list");
    });

    // 2. Forward to mock API correctly
    await test("Request forwarded to mock API", async () => {
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

    // 3. SSE streaming response
    await test("SSE streaming response works", async () => {
      const { status, headers, events } = await fetchSSE(`${BASE}/v1/chat/completions`, {
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

      // Parse intermediate events
      const parsed = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e));
      assert(parsed.length > 0, "Should have parsed chunks");
      assert(parsed[0].object === "chat.completion.chunk", "Should be chunk objects");
    });

    // 4. Channel failover: A returns 502, request goes to B
    await test("Channel failover on 502", async () => {
      // Make mock A return 502 for next 10 requests
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
      assert(body.choices && body.choices.length > 0, "Should get a valid response from backup");

      // Mock B should have received the request
      const bReqs = mockB.requests.filter(
        (r) => r.url === "/v1/chat/completions" && r.method === "POST"
      );
      assert(bReqs.length > 0, "Backup mock should have received the failover request");

      // Reset mock A
      mockA.setForceStatus(0);
    });

    // 5. API key rotation (round-robin)
    await test("API key rotation (round-robin)", async () => {
      // Reset everything fresh
      mockA.setForceStatus(0);
      mockA.resetRequests();

      // We need the channel to be healthy again. Send a couple warm-up requests first.
      // The primary channel may be marked unhealthy from the failover test.
      // Wait briefly and use the toggle API to re-enable if needed.
      // Actually, let's just re-enable via toggle and send requests.

      // First, ensure primary channel is enabled
      await fetch(`${UI_BASE}/api/channels/mock-primary/toggle`, { method: "POST" });
      // If it was disabled, toggle enables it. If enabled, toggle disables it.
      // Check current state:
      const channelsRes = await fetchJSON(`${UI_BASE}/api/channels`);
      const primary = channelsRes.body.find((c) => c.name === "mock-primary");
      if (!primary.enabled) {
        // Toggle again to re-enable
        await fetch(`${UI_BASE}/api/channels/mock-primary/toggle`, { method: "POST" });
      }

      // Send multiple requests and collect the auth headers seen by mock A
      mockA.resetRequests();
      const numReqs = 6;
      for (let i = 0; i < numReqs; i++) {
        await fetchJSON(`${BASE}/v1/models`);
      }

      const authHeaders = mockA.requests.map((r) => r.headers.authorization);
      const uniqueKeys = new Set(authHeaders);

      // With 3 keys and round-robin, we should see at least 2 different keys over 6 requests
      assert(
        uniqueKeys.size >= 2,
        `Expected at least 2 different keys in rotation, got ${uniqueKeys.size}: ${[...uniqueKeys].join(", ")}`
      );
    });

    // 6. 429 retry — mock returns 429 once then 200
    await test("429 rate-limit retry", async () => {
      mockA.setForceStatus(429, 1); // Only first request returns 429
      mockA.resetRequests();

      const { status, body } = await fetchJSON(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "retry test" }],
        }),
      });

      // After retry, should get 200 from either mock A (second attempt) or mock B (failover)
      assertEqual(status, 200, "status after retry");
      assert(body.choices, "Should have a valid response after retry");

      mockA.setForceStatus(0);
    });

    // 7. Web UI accessible
    await test("Web UI is accessible", async () => {
      const { status, text } = await fetchRaw(UI_BASE);
      assertEqual(status, 200, "status");
      assert(
        text.includes("<html") || text.includes("AI-Tunnel") || text.includes("<!DOCTYPE"),
        "Should return HTML content"
      );
    });

    // 8. API /api/status
    await test("API /api/status returns valid status", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/status`);
      assertEqual(status, 200, "status");
      assertEqual(body.status, "running", "status field");
      assert(typeof body.uptime === "number", "uptime should be a number");
      assert(body.channels, "Should have channels info");
      assertEqual(body.channels.total, 2, "total channels");
    });

    // 9. API /api/channels
    await test("API /api/channels returns channel list", async () => {
      const { status, body } = await fetchJSON(`${UI_BASE}/api/channels`);
      assertEqual(status, 200, "status");
      assert(Array.isArray(body), "Should be an array");
      assertEqual(body.length, 2, "channel count");

      const names = body.map((c) => c.name).sort();
      assert(names.includes("mock-primary"), "Should have mock-primary");
      assert(names.includes("mock-backup"), "Should have mock-backup");

      // Each channel should have expected fields
      for (const ch of body) {
        assert(ch.target, `${ch.name} should have target`);
        assert(ch.keys, `${ch.name} should have keys info`);
        assert(typeof ch.keys.alive === "number", `${ch.name} keys.alive should be number`);
        assert(typeof ch.keys.total === "number", `${ch.name} keys.total should be number`);
        assert(ch.stats, `${ch.name} should have stats`);
      }
    });

    // 10. Channel toggle
    await test("Channel toggle (POST /api/channels/:name/toggle)", async () => {
      // Get initial state
      let { body: channels } = await fetchJSON(`${UI_BASE}/api/channels`);
      const initial = channels.find((c) => c.name === "mock-backup");
      const initialEnabled = initial.enabled;

      // Toggle
      const { status, body: toggled } = await fetchJSON(
        `${UI_BASE}/api/channels/mock-backup/toggle`,
        { method: "POST" }
      );
      assertEqual(status, 200, "toggle status");
      assertEqual(toggled.enabled, !initialEnabled, "should be toggled");

      // Verify via channel list
      ({ body: channels } = await fetchJSON(`${UI_BASE}/api/channels`));
      const after = channels.find((c) => c.name === "mock-backup");
      assertEqual(after.enabled, !initialEnabled, "list should reflect toggle");

      // Toggle back to restore
      await fetch(`${UI_BASE}/api/channels/mock-backup/toggle`, { method: "POST" });
    });

  } finally {
    // ── Cleanup ────────────────────────────────────
    console.log("\n  Cleaning up...");
    tunnelProc.kill("SIGTERM");
    await mockA.close();
    await mockB.close();
    // Give process time to exit
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── Summary ──────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  console.log("\n" + "═".repeat(50));
  console.log(`  Results: ${passed} passed, ${failed} failed (${total} total)`);
  console.log("═".repeat(50));

  if (failed > 0) {
    console.log("\n  Failed tests:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`    ❌ ${r.name}: ${r.reason}`);
    }
    console.log("");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n💥 Test runner crashed:", err);
  process.exit(2);
});
