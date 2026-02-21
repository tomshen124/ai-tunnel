#!/usr/bin/env bash
set -euo pipefail

# scripts/install.sh
# System-wide install for Linux (systemd)
# Usage:
#   sudo bash scripts/install.sh [--config /etc/ai-tunnel/tunnel.config.yaml] [--service-name ai-tunnel]

SERVICE_NAME="ai-tunnel"
CONFIG_PATH="/etc/ai-tunnel/tunnel.config.yaml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_PATH="$2"; shift 2;;
    --service-name) SERVICE_NAME="$2"; shift 2;;
    -h|--help)
      cat <<EOF
AI-Tunnel Linux installer (systemd)

Options:
  --config <path>        Config path (default: /etc/ai-tunnel/tunnel.config.yaml)
  --service-name <name>  systemd unit name (default: ai-tunnel)

Notes:
- Expects 'ai-tunnel' to be already installed (e.g. npm -g ai-tunnel).
- Creates a systemd service that runs in foreground (systemd will supervise it).
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (use sudo)." >&2
  exit 1
fi

AI_TUNNEL_BIN="$(command -v ai-tunnel || true)"
if [[ -z "$AI_TUNNEL_BIN" ]]; then
  echo "ai-tunnel binary not found in PATH. Install first: npm i -g ai-tunnel" >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_PATH")"

# Seed config if missing
if [[ ! -f "$CONFIG_PATH" ]]; then
  # Try to locate example config relative to the installed CLI.
  # Typical global install path: .../lib/node_modules/ai-tunnel/src/cli.mjs
  PKG_ROOT="$(cd "$(dirname "$AI_TUNNEL_BIN")/../lib/node_modules/ai-tunnel" 2>/dev/null && pwd || true)"
  if [[ -n "$PKG_ROOT" && -f "$PKG_ROOT/tunnel.config.example.yaml" ]]; then
    cp "$PKG_ROOT/tunnel.config.example.yaml" "$CONFIG_PATH"
    echo "✅ Seeded config at: $CONFIG_PATH"
  else
    cat > "$CONFIG_PATH" <<'EOF'
# AI-Tunnel config
# Tip: start from tunnel.config.example.yaml in the repo.
server:
  host: 127.0.0.1
  port: 9000
  ui:
    host: 127.0.0.1
    port: 3000
    enabled: true
# uiAuthToken: ""   # optional: require Bearer token for Web UI/API

channels: []
EOF
    echo "✅ Created empty config at: $CONFIG_PATH"
    echo "   Please edit it before starting the service."
  fi
else
  echo "ℹ️  Config exists: $CONFIG_PATH"
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=AI-Tunnel (API tunnel proxy)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${AI_TUNNEL_BIN} start --config ${CONFIG_PATH}
Restart=always
RestartSec=2
# Raise file descriptor limit for high concurrency
LimitNOFILE=65535

# Optional hardening (uncomment if compatible with your config/log paths)
# NoNewPrivileges=true
# PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Wrote systemd unit: $UNIT_PATH"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "✅ Service started: $SERVICE_NAME"
echo "   Status:  systemctl status $SERVICE_NAME"
echo "   Logs:    journalctl -u $SERVICE_NAME -f"
