# AI-Tunnel

[![Tests](https://github.com/tomshen124/ai-tunnel/actions/workflows/test.yml/badge.svg)](https://github.com/tomshen124/ai-tunnel/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@tomshen124/ai-tunnel.svg)](https://www.npmjs.com/package/@tomshen124/ai-tunnel)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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
- **Cross-Platform** — Works on Linux, macOS, and Windows (pure JS SSH via ssh2)
- **Zero Framework** — Pure Node.js, no express/koa dependencies

## Quick Start

### Install

```bash
# Global install from npm
npm install -g @tomshen124/ai-tunnel

# Or clone and run directly
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install
```

**Uninstall:**
```bash
curl -fsSL https://raw.githubusercontent.com/tomshen124/ai-tunnel/main/install.sh | bash -s -- --uninstall
```

### Configure

```bash
# Generate config file
ai-tunnel init
# Or
cp tunnel.config.example.yaml tunnel.config.yaml

# Edit config — add your API targets and keys
vim tunnel.config.yaml
```

### Run

```bash
# Start the tunnel
ai-tunnel start

# Check status
ai-tunnel status

# Stop
ai-tunnel stop
```

Once running:
- **Proxy entry:** `http://127.0.0.1:9000`
- **Web UI:** `http://127.0.0.1:3000`

### Usage on VPS

Point your AI application's API Base URL to the tunnel:

```
http://localhost:9000
```

For example, with any OpenAI-compatible client:
```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:9000/v1",
    api_key="sk-your-key",  # Keys are managed in tunnel config
)
```

Or in a YAML config:
```yaml
providers:
  - baseURL: http://localhost:9000/v1
    apiKey: sk-your-key
```

## Configuration

See [`tunnel.config.example.yaml`](tunnel.config.example.yaml) for a complete annotated example.

### Minimal Config (No SSH Tunnel)

If your VPS can reach the API directly (no Cloudflare blocking), you only need the proxy + routing features:

```yaml
server:
  port: 9000
  host: "127.0.0.1"
  ui:
    enabled: true
    port: 3000

channels:
  - name: "primary"
    target: "https://api.example.com"
    keys: ["sk-key1", "sk-key2"]
    weight: 10

  - name: "backup"
    target: "https://backup-api.example.com"
    keys: ["sk-backup"]
    weight: 5
    fallback: true

settings:
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
```

### Full Config with SSH Tunnel

This is the main use case — relay requests from VPS through your local machine:

```yaml
server:
  port: 9000              # Unified proxy entry
  host: "127.0.0.1"
  ui:
    enabled: true
    port: 3000
    host: "127.0.0.1"

# SSH connection to your VPS
ssh:
  host: "203.0.113.10"           # Your VPS IP
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"  # Or use password auth
  # password: "your-password"       # Alternative to privateKeyPath

# API Channels — each channel is a target API endpoint
channels:
  - name: "primary-api"
    target: "https://api-site.example.com"
    keys:
      - "sk-key-1"
      - "sk-key-2"
      - "sk-key-3"
    keyStrategy: "round-robin"    # round-robin | random
    weight: 10                    # Higher = higher priority
    tunnel:
      enabled: true
      localPort: 8080             # Local port for tunnel endpoint
      remotePort: 9090            # Port on VPS that maps to localPort
    healthCheck:
      path: "/v1/models"
      intervalMs: 60000           # Check every 60 seconds
      timeoutMs: 5000

  - name: "backup-api"
    target: "https://backup-api.example.com"
    keys:
      - "sk-backup-key"
    weight: 5
    fallback: true                # Only used when primary fails
    tunnel:
      enabled: true
      localPort: 8081
      remotePort: 9091

# Route groups — map request paths to channel pools
routes:
  - path: "/v1/**"
    channels: ["primary-api", "backup-api"]
    strategy: "priority"          # priority | round-robin | lowest-latency

# Global settings
settings:
  reconnectInterval: 5000         # SSH reconnect delay (ms)
  logLevel: "info"                # debug | info | warn | error
  hotReload: true                 # Auto-reload config on file change
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "exponential"        # exponential | fixed
    baseDelayMs: 1000
    maxDelayMs: 10000
```

### How SSH Tunnels Work

```
┌───────────────────────┐       SSH Connection       ┌───────────────────────┐
│      Your VPS         │ ◀──────────────────────── │    Your Local Machine  │
│                       │                            │                       │
│  App → localhost:9000 │                            │  ai-tunnel running    │
│     (proxy entry)     │                            │                       │
│                       │   Reverse Tunnel           │  localhost:8080 ──────┼──▶ api-site.com
│  localhost:9090 ◀─────┼── localPort:8080           │  localhost:8081 ──────┼──▶ backup-api.com
│  localhost:9091 ◀─────┼── localPort:8081           │                       │
└───────────────────────┘                            └───────────────────────┘
```

**Flow:**
1. AI-Tunnel runs on your **local machine** and connects to the VPS via SSH
2. SSH reverse tunnels map VPS ports (9090, 9091) to local ports (8080, 8081)
3. The proxy on port 9000 routes requests through the tunnel to your local machine
4. Your local machine forwards to the target API (using residential IP → no CF block)

**Setup steps:**
1. Install ai-tunnel on your **local machine**
2. Configure SSH with your VPS credentials
3. Configure channels with target APIs and tunnel port mappings
4. Run `ai-tunnel start` — it connects to VPS and establishes tunnels
5. On VPS, set your app's API URL to `http://localhost:9000`

## Web UI

A dark-themed clean switch panel at `http://127.0.0.1:3000`:

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

- **429 Rate Limited** → Swap key and retry
- **401/403 Auth Failed** → Mark key invalid, swap key
- **502/503/504** → Swap channel and retry
- Exponential backoff to prevent cascading failures

## CLI Commands

```
ai-tunnel init                  Create tunnel.config.yaml from template
ai-tunnel start                 Start in background (daemon mode)
ai-tunnel start -f              Start in foreground
ai-tunnel start --config PATH   Start with a specific config file
ai-tunnel status                Show tunnel status and channel health
ai-tunnel stop                  Stop a running tunnel process
ai-tunnel logs                  Show recent logs
ai-tunnel logs -f               Follow logs (live)
ai-tunnel help                  Show help
```

## v1 Compatibility

The v1 `sites` config format is still supported — it auto-converts to v2 `channels` format on startup.

## Tech Stack

- **Runtime:** Node.js >= 18 (ESM)
- **SSH:** ssh2 (pure JS, no system SSH client needed)
- **Config:** js-yaml
- **HTTP:** Node.js native http/https
- **UI:** htmx + Tailwind CDN (zero build)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Global status |
| `/api/channels` | GET | Channel list + status |
| `/api/channels/:name/toggle` | POST | Enable/disable channel |
| `/api/channels/:name/keys` | POST | Add key (`{"key": "sk-..."}`) |
| `/api/channels/:name/keys/:i` | DELETE | Remove key by index |
| `/api/logs` | GET | SSE real-time log stream |
| `/api/logs/recent` | GET | Recent 50 log entries |
| `/api/stats` | GET | Statistics |
| `/api/config/reload` | POST | Manual config reload |

## License

MIT
