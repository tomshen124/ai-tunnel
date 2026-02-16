# AI-Tunnel

A lightweight, cross-platform API reverse proxy with SSH tunnel support.

Route API requests through local networks via SSH reverse tunnels. Built with Node.js, zero native dependencies.

## Features

- 🔀 **Multi-site reverse proxy** — proxy multiple API endpoints, each on its own port
- 🔗 **SSH reverse tunnels** — expose local proxy ports to remote servers via SSH
- 🔄 **Auto-reconnect** — automatic reconnection on tunnel drop
- 📝 **YAML config** — simple, declarative configuration
- 🖥️ **Cross-platform** — macOS, Windows, Linux
- 📦 **Zero native deps** — pure JS SSH implementation (ssh2)

## Quick Start

```bash
# Install
npm install -g ai-tunnel

# Create config
ai-tunnel init

# Edit tunnel.config.yaml with your settings, then:
ai-tunnel start
```

## Configuration

```yaml
ssh:
  host: "your-server-ip"
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"

sites:
  - name: "my-api"
    target: "https://api.example.com"
    localPort: 8080
    remotePort: 9090

settings:
  reconnectInterval: 5000
  healthCheckInterval: 60000
  logLevel: "info"
```

## How It Works

```
Remote Server :9090 ──SSH Tunnel──→ Local :8080 ──Proxy──→ Target API
```

Your remote server accesses `localhost:9090`, which tunnels to your local machine's proxy, which forwards to the target API.

## Roadmap

- [x] Multi-site reverse proxy
- [x] SSH reverse tunnel with auto-reconnect
- [x] YAML configuration
- [ ] Health checks
- [ ] Terminal status dashboard
- [ ] System service support (launchd / systemd / Windows Service)
- [ ] Web UI

## License

MIT
