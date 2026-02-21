#!/usr/bin/env bash
# install.sh — AI-Tunnel installer/uninstaller
# Usage:
#   Install:    curl -fsSL https://raw.githubusercontent.com/tomshen124/ai-tunnel/main/install.sh | bash
#   Uninstall:  curl -fsSL https://raw.githubusercontent.com/tomshen124/ai-tunnel/main/install.sh | bash -s -- --uninstall

set -euo pipefail

REPO="tomshen124/ai-tunnel"
INSTALL_DIR="${HOME}/.ai-tunnel"
BIN_NAME="ai-tunnel"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

# --- Uninstall ---
if [[ "${1:-}" == "--uninstall" ]]; then
  info "Uninstalling AI-Tunnel..."
  
  # Remove symlink
  for bin_dir in /usr/local/bin "${HOME}/.local/bin"; do
    if [ -L "${bin_dir}/${BIN_NAME}" ]; then
      rm -f "${bin_dir}/${BIN_NAME}"
      ok "Removed ${bin_dir}/${BIN_NAME}"
    fi
  done
  
  # Remove install dir
  if [ -d "${INSTALL_DIR}" ]; then
    rm -rf "${INSTALL_DIR}"
    ok "Removed ${INSTALL_DIR}"
  fi
  
  # Remove systemd service
  if command -v systemctl &>/dev/null; then
    if [ -f /etc/systemd/system/ai-tunnel.service ]; then
      info "Removing systemd service..."
      sudo systemctl stop ai-tunnel 2>/dev/null || true
      sudo systemctl disable ai-tunnel 2>/dev/null || true
      sudo rm -f /etc/systemd/system/ai-tunnel.service
      sudo systemctl daemon-reload 2>/dev/null || true
      ok "Systemd service removed"
    fi
  fi

  ok "AI-Tunnel uninstalled."
  exit 0
fi

# --- Pre-checks ---
info "Checking prerequisites..."

# Check Node.js
if ! command -v node &>/dev/null; then
  err "Node.js not found. Please install Node.js >= 18 first."
  echo "  https://nodejs.org/en/download"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "${NODE_VERSION}" -lt 18 ]; then
  err "Node.js >= 18 required, found v$(node -v | sed 's/v//')"
  exit 1
fi
ok "Node.js v$(node -v | sed 's/v//') found"

# Check npm
if ! command -v npm &>/dev/null; then
  err "npm not found. Please install npm."
  exit 1
fi

# Check curl or wget
if command -v curl &>/dev/null; then
  DOWNLOAD="curl -fsSL"
elif command -v wget &>/dev/null; then
  DOWNLOAD="wget -qO-"
else
  err "curl or wget required."
  exit 1
fi

# --- Get latest version ---
info "Fetching latest release..."
LATEST_TAG=$($DOWNLOAD "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "${LATEST_TAG}" ]; then
  err "Failed to fetch latest release. Check your network."
  exit 1
fi
ok "Latest version: ${LATEST_TAG}"

# --- Backup existing installation ---
if [ -d "${INSTALL_DIR}" ]; then
  BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
  warn "Existing installation found, backing up to ${BACKUP_DIR}"
  mv "${INSTALL_DIR}" "${BACKUP_DIR}"
fi

# --- Download & extract ---
info "Downloading AI-Tunnel ${LATEST_TAG}..."
TARBALL_URL="https://github.com/${REPO}/archive/refs/tags/${LATEST_TAG}.tar.gz"

mkdir -p "${INSTALL_DIR}"
$DOWNLOAD "${TARBALL_URL}" | tar -xz --strip-components=1 -C "${INSTALL_DIR}"
ok "Extracted to ${INSTALL_DIR}"

# --- Install dependencies ---
info "Installing dependencies..."
cd "${INSTALL_DIR}"
npm install --production --no-fund --no-audit 2>&1 | tail -1
ok "Dependencies installed"

# --- Create symlink ---
BIN_TARGET="${INSTALL_DIR}/src/cli.mjs"
chmod +x "${BIN_TARGET}"

# Try /usr/local/bin first, fall back to ~/.local/bin
if [ -w /usr/local/bin ] || [ "$(id -u)" -eq 0 ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="${HOME}/.local/bin"
  mkdir -p "${BIN_DIR}"
fi

ln -sf "${BIN_TARGET}" "${BIN_DIR}/${BIN_NAME}"
ok "Linked ${BIN_DIR}/${BIN_NAME}"

# Check if bin dir is in PATH
if ! echo "${PATH}" | tr ':' '\n' | grep -q "^${BIN_DIR}$"; then
  warn "${BIN_DIR} is not in your PATH. Add it:"
  echo "  export PATH=\"${BIN_DIR}:\$PATH\""
fi

# --- Verify ---
VERSION=$(cd "${INSTALL_DIR}" && node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  AI-Tunnel v${VERSION} installed successfully! 🚀${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Quick start:"
echo "    ai-tunnel init        # Create config file"
echo "    ai-tunnel start       # Start in background"
echo "    ai-tunnel stop        # Stop the tunnel"
echo "    ai-tunnel restart     # Restart"
echo "    ai-tunnel status      # Show status"
echo "    ai-tunnel logs -f     # Follow live logs"
echo ""
echo "  Config: tunnel.config.yaml"
echo "  Docs:   https://github.com/${REPO}"
echo ""
# --- Setup systemd service (Linux only) ---
if command -v systemctl &>/dev/null; then
  info "Setting up systemd service..."
  
  RUN_USER=$(whoami)
  NODE_PATH=$(command -v node)
  
  SERVICE_CONTENT="[Unit]
Description=AI-Tunnel API Proxy
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} ${INSTALL_DIR}/src/index.mjs --config ${INSTALL_DIR}/tunnel.config.yaml
Restart=always
RestartSec=2
# Raise file descriptor limit for high concurrency
LimitNOFILE=65535
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target"

  if [ "$(id -u)" -eq 0 ]; then
    echo "${SERVICE_CONTENT}" > /etc/systemd/system/ai-tunnel.service
    systemctl daemon-reload
    systemctl enable ai-tunnel
    ok "Systemd service created and enabled"
  else
    echo "${SERVICE_CONTENT}" | sudo tee /etc/systemd/system/ai-tunnel.service > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable ai-tunnel
    ok "Systemd service created and enabled"
  fi
  
  echo ""
  echo "  Service commands:"
  echo "    sudo systemctl start ai-tunnel     # Start"
  echo "    sudo systemctl stop ai-tunnel      # Stop"
  echo "    sudo systemctl restart ai-tunnel   # Restart"
  echo "    sudo systemctl status ai-tunnel    # Status"
  echo "    journalctl -u ai-tunnel -f         # Follow logs"
  echo ""
else
  warn "systemd not found (macOS?). Use 'ai-tunnel start' for daemon mode."
  echo ""
fi

echo "  Uninstall:"
echo "    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash -s -- --uninstall"
echo ""
