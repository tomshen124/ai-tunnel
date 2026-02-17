# AI-Tunnel

[![Tests](https://github.com/tomshen124/ai-tunnel/actions/workflows/test.yml/badge.svg?branch=feat/v2)](https://github.com/tomshen124/ai-tunnel/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@tomshen124/ai-tunnel.svg)](https://www.npmjs.com/package/@tomshen124/ai-tunnel)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-yellow.svg)](https://opensource.org/licenses/Apache-2.0)

Cross-platform API tunnel proxy — multi-channel smart routing, automatic failover, and a clean switch panel.

## The Problem

Third-party AI model API sites (OpenAI-compatible) use Cloudflare Bot Management to block requests from cloud server IP ranges:

- ✅ Local machine / home network → API site **works fine**
- ❌ Cloud server (VPS) → API site **blocked by CF 403**

## The Solution

AI-Tunnel runs on your local machine, using SSH reverse tunnels to relay requests from your VPS through your local network to reach target APIs.

```
App on VPS → localhost:9000 (unified entry)
                  ↓ Routing engine (pick channel + key)
            SSH reverse tunnel
                  ↓
            Local reverse proxy → Target API (residential IP, not blocked)
```

## Key Features

- **Unified Entry** — Single port `:9000`, upstream apps only need one address
- **Multi-Channel Redundancy** — Multiple API sites form a channel pool with automatic failover
- **API Key Pool** — Multiple keys per channel with rotation to avoid rate limits
- **Smart Routing** — Priority / Round-Robin / Lowest-Latency strategies
- **Smart Retry** — 429 swaps key, 5xx swaps channel, exponential backoff
- **Health Checks** — Periodic channel availability detection, auto-bypass on failure
- **Web UI** — Clean CC-Switch-style dark panel with real-time status and one-click toggle
- **Hot Reload** — Change config without restarting
- **SSE Streaming** — Full support for AI API streaming responses
- **SSH Tunnel** — Auto-establish, reconnect on disconnect, heartbeat keep-alive
- **Zero Framework** — Pure Node.js, no express/koa dependencies

## Quick Start

### Install

```bash
# Global install
npm install -g ai-tunnel

# Or clone and run
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install
```

### Configure

```bash
# Generate config file
ai-tunnel init
# Or
cp tunnel.config.example.yaml tunnel.config.yaml

# Edit config
vim tunnel.config.yaml
```

### Run

```bash
# Start
ai-tunnel start
# Or
npm start
# Or
node src/index.mjs
```

Once running:
- **Proxy entry:** `http://127.0.0.1:9000`
- **Web UI:** `http://127.0.0.1:3000`

### Usage on VPS

Set your AI application's API Base URL to:

```
http://localhost:9000
```

For example, in OpenClaw config:
```yaml
providers:
  - baseURL: http://localhost:9000/v1
    apiKey: sk-your-key  # Keys can be managed in tunnel config
```

## Configuration

```yaml
# Server
server:
  port: 9000              # Unified proxy entry
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

# API Channels
channels:
  - name: "primary"
    target: "https://api-site.com"
    keys: ["sk-key1", "sk-key2"]
    keyStrategy: "round-robin"    # round-robin | random
    weight: 10                    # Priority weight
    tunnel:                       # SSH tunnel config (optional)
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
    fallback: true                # Mark as fallback

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

A dark-themed clean switch panel:

- 🟢🔴 Real-time channel status display
- Latency / success rate / call volume stats
- One-click pause/enable channels
- Live request log scrolling
- SSE push, no manual refresh needed

## Routing Strategies

| Strategy | Description |
|----------|-------------|
| `priority` | Sorted by weight, highest first. Auto-degrade on failure |
| `round-robin` | Even distribution across channels |
| `lowest-latency` | Pick the channel with lowest recent latency |

## Failover

```
Request → Channel A (weight: 10)
            ↓ Failed? (5xx / timeout)
          Channel B (weight: 5)
            ↓ Also failed?
          Return error + log alert
```

- 429 Rate Limited → Swap key and retry
- 401/403 Auth Failed → Mark key invalid, swap key
- 502/503/504 → Swap channel and retry
- Exponential backoff to prevent cascading failures

## v1 Compatibility

The v1 `sites` config format is still supported — it auto-converts to v2 `channels` format on startup.

## Tech Stack

- **Runtime:** Node.js >= 18 (ESM)
- **SSH:** ssh2 (pure JS, no system dependencies)
- **Config:** js-yaml
- **HTTP:** Node.js native http/https
- **UI:** htmx + Tailwind CDN (zero build)

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Global status |
| `/api/channels` | GET | Channel list + status |
| `/api/channels/:name/toggle` | POST | Enable/disable channel |
| `/api/channels/:name/keys` | POST | Add key |
| `/api/channels/:name/keys/:i` | DELETE | Remove key |
| `/api/logs` | GET | SSE real-time log stream |
| `/api/logs/recent` | GET | Recent 50 log entries |
| `/api/stats` | GET | Statistics |
| `/api/config/reload` | POST | Manual config reload |

## License

Apache-2.0
