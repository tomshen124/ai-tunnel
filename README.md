# AI-Tunnel

A cross-platform API tunnel proxy with multi-channel intelligent routing, automatic failover, and a clean switch panel.

## Problem Background

Some third-party AI model API providers (OpenAI-compatible) have enabled Cloudflare Bot Management and block requests coming from cloud/VPS IP ranges:

- ✅ Local computer / home network → API provider **works normally**
- ❌ Cloud server (VPS) → API provider **blocked with CF 403**

## Solution

AI-Tunnel runs on your local computer and uses an SSH reverse tunnel to relay requests from a VPS back to your local machine, then accesses the target API via your residential egress.

```
Apps on VPS → localhost:9000 (single entry)
                 ↓ routing engine (select channel + key)
           SSH reverse tunnel
                 ↓
        Local reverse proxy → Target API (residential IP, not blocked)
```

## Key Features

- **Single entry point** — One port `:9000`; upstream apps only need a single base URL
- **Multi-channel redundancy** — Multiple API providers form a channel pool with automatic failover
- **API key pool** — Multiple keys per channel; rotate keys to avoid rate limits
- **Intelligent routing** — Three strategies: Priority / Round-Robin / Lowest-Latency
- **Smart retries** — Switch keys on 429, switch channels on 5xx, exponential backoff
- **Health checks** — Periodically probes channel availability and bypasses failures automatically
- **Web UI** — A minimal CC-Switch-style panel with live status and one-click switching
- **Hot config reload** — Update config without restarting
- **SSE streaming** — Full support for streaming responses from AI APIs
- **SSH tunnel** — Auto connect, reconnect on drop, keep-alive heartbeats
- **Zero framework** — Pure Node.js; no express/koa dependency

## Quick Start

### Install

```bash
# Install globally
npm install -g ai-tunnel

# Or run from source
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install
```

### Configure

```bash
# Generate a config file
ai-tunnel init
# or
cp tunnel.config.example.yaml tunnel.config.yaml

# Edit the config
vim tunnel.config.yaml
```

### Start

```bash
# Start
ai-tunnel start
# or
npm start
# or
node src/index.mjs
```

After starting:
- **Proxy entry:** `http://127.0.0.1:9000`
- **Web UI:** `http://127.0.0.1:3000`

### Use from your VPS application

Change your AI app's API Base URL to:

```
http://localhost:9000
```

For example, an OpenClaw config:

```yaml
providers:
  - baseURL: http://localhost:9000/v1
    apiKey: sk-your-key  # Keys can be centrally managed in the tunnel config
```

## Configuration

```yaml
# Server
server:
  port: 9000              # unified proxy entry
  host: "127.0.0.1"
  ui:
    enabled: true
    port: 3000            # Web UI port

# SSH (optional)
ssh:
  host: "VPS_IP"
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"

# API channels
channels:
  - name: "primary"
    target: "https://api-site.com"
    keys: ["sk-key1", "sk-key2"]
    keyStrategy: "round-robin"    # round-robin | random
    weight: 10                    # priority weight
    tunnel:                       # SSH tunnel settings (optional)
      enabled: true
      localPort: 8080
      remotePort: 9090
    healthCheck:
      path: "/v1/models"
      intervalMs: 60000

  - name: "backup"
    target: "https://backup-api.com"
    keys: ["sk-backup"]
    weight: 5
    fallback: true                # mark as a fallback channel

# Routing
routes:
  - path: "/v1/**"
    channels: ["primary", "backup"]
    strategy: "priority"          # priority | round-robin | lowest-latency

# Global
settings:
  hotReload: true
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "exponential"
```

## Web UI

A clean dark-themed switch panel:

- 🟢🔴 Real-time channel status
- Latency / success rate / request volume stats
- One-click pause/enable channels
- Live scrolling request logs
- SSE push updates (no manual refresh)

## Routing Strategies

| Strategy | Description |
|------|------|
| `priority` | Sort by weight; prefer higher priority. Automatically degrades on failures |
| `round-robin` | Evenly distribute requests by rotation |
| `lowest-latency` | Choose the channel with the lowest recent latency |

## Failover

```
Request → Channel A (weight: 10)
            ↓ fails? (5xx / timeout)
         Channel B (weight: 5)
            ↓ still fails?
         Return error + log alert
```

- Rate-limited (429) → switch key and retry
- Auth failures (401/403) → mark the key invalid and switch key
- 502/503/504 → switch channel and retry
- Exponential backoff to avoid thundering herds

## v1 Compatibility

The v1 `sites` configuration format is still supported. It will be automatically converted to the v2 `channels` format on startup.

## Tech Stack

- **Runtime:** Node.js >= 18 (ESM)
- **SSH:** ssh2 (pure JS, no system dependency)
- **Config:** js-yaml
- **HTTP:** Node.js built-in http/https
- **UI:** htmx + Tailwind CDN (zero build)

## API

| Endpoint | Method | Description |
|------|------|------|
| `/api/status` | GET | Global status |
| `/api/channels` | GET | Channel list + status |
| `/api/channels/:name/toggle` | POST | Enable/disable a channel |
| `/api/channels/:name/keys` | POST | Add a key |
| `/api/channels/:name/keys/:i` | DELETE | Delete a key |
| `/api/logs` | GET | SSE live log stream |
| `/api/logs/recent` | GET | Most recent 50 log entries |
| `/api/stats` | GET | Stats |
| `/api/config/reload` | POST | Manually reload config |

## License

Apache-2.0
