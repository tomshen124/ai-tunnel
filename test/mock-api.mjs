// test/mock-api.mjs - Mock API server simulating an OpenAI-compatible endpoint
// Supports: GET /v1/models, POST /v1/chat/completions (stream + non-stream)
// Configurable: delay, forced status codes, request logging

import { createServer } from "http";

/**
 * Create a mock API server.
 * @param {object} opts
 * @param {number} opts.port - Port to listen on
 * @param {number} [opts.delayMs=0] - Artificial response delay
 * @param {number} [opts.forceStatus=0] - Force a specific status code on all requests (0 = disabled)
 * @param {number} [opts.forceStatusCount=Infinity] - How many requests to force the status on, then revert to normal
 * @returns {Promise<object>} - { server, requests, setForceStatus, setDelay, close }
 */
export function createMockApi(opts) {
  const {
    port,
    delayMs: initialDelay = 0,
    forceStatus: initialForceStatus = 0,
    forceStatusCount: initialForceStatusCount = Infinity,
  } = opts;

  let delayMs = initialDelay;
  let forceStatus = initialForceStatus;
  let forceStatusCount = initialForceStatusCount;
  let forcedSoFar = 0;

  // Track all received requests for assertions
  const requests = [];

  const server = createServer(async (req, res) => {
    // Buffer request body
    const bodyChunks = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const bodyStr = Buffer.concat(bodyChunks).toString();
    let body = null;
    try { body = JSON.parse(bodyStr); } catch { /* not JSON */ }

    const entry = {
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      body,
      timestamp: Date.now(),
    };
    requests.push(entry);

    // Artificial delay
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Forced status code
    if (forceStatus > 0 && forcedSoFar < forceStatusCount) {
      forcedSoFar++;
      res.writeHead(forceStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: { message: `Forced ${forceStatus}`, type: "mock_error" },
      }));
      return;
    }

    // ─── Route handling ─────────────────────────
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname;

    // GET /v1/models
    if (path === "/v1/models" && req.method === "GET") {
      return handleModels(res);
    }

    // POST /v1/chat/completions
    if (path === "/v1/chat/completions" && req.method === "POST") {
      return handleChatCompletions(res, body);
    }

    // Fallback 404
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found", type: "mock_error" } }));
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        requests,
        setForceStatus(status, count = Infinity) {
          forceStatus = status;
          forceStatusCount = count;
          forcedSoFar = 0;
        },
        setDelay(ms) {
          delayMs = ms;
        },
        resetRequests() {
          requests.length = 0;
        },
        close() {
          return new Promise((r) => server.close(r));
        },
      });
    });
    server.on("error", reject);
  });
}

// ─── Endpoint Handlers ───────────────────────────────

function handleModels(res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    object: "list",
    data: [
      { id: "gpt-4o", object: "model", created: 1700000000, owned_by: "mock" },
      { id: "gpt-4o-mini", object: "model", created: 1700000000, owned_by: "mock" },
      { id: "claude-3.5-sonnet", object: "model", created: 1700000000, owned_by: "mock" },
    ],
  }));
}

function handleChatCompletions(res, body) {
  const model = body?.model || "gpt-4o";
  const stream = body?.stream === true;

  if (stream) {
    return handleStreamResponse(res, model);
  }

  // Non-stream response
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    id: "chatcmpl-mock-" + Math.random().toString(36).slice(2, 10),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello! This is a mock response from ai-tunnel test server.",
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
  }));
}

function handleStreamResponse(res, model) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const chunks = ["Hello", "!", " This", " is", " a", " mock", " stream", "."];
  const id = "chatcmpl-mock-" + Math.random().toString(36).slice(2, 10);

  let i = 0;
  const interval = setInterval(() => {
    if (i < chunks.length) {
      const data = {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content: chunks[i] },
            finish_reason: null,
          },
        ],
      };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      i++;
    } else {
      // Final chunk with finish_reason
      const finalData = {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      };
      res.write(`data: ${JSON.stringify(finalData)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      clearInterval(interval);
    }
  }, 20);
}

// ─── CLI entry (run standalone) ──────────────────────

if (process.argv[1] && process.argv[1].endsWith("mock-api.mjs")) {
  const port = parseInt(process.argv[2] || "18001", 10);
  createMockApi({ port }).then((mock) => {
    console.log(`🎭 Mock API server running on http://127.0.0.1:${port}`);
    process.on("SIGINT", () => {
      mock.close().then(() => process.exit(0));
    });
  });
}
