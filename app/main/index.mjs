// app/main/index.mjs - Electron main process
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron';
import { fork } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.VITE_DEV_SERVER_URL;
// In production the app is packed inside app.asar — config files must live
// outside the archive.  Use Electron's userData directory (e.g.
// ~/Library/Application Support/AI-Tunnel) for writable config storage.
const projectRoot = isDev
  ? resolve(__dirname, '..', '..')
  : app.getPath('userData');

// ─── Globals ─────────────────────────────────────────
let mainWindow = null;
let tray = null;
let tunnelProcess = null;
let tunnelStatus = 'stopped'; // stopped | starting | running | error

// ─── Config path ─────────────────────────────────────
function getConfigPath() {
  // Ensure userData directory exists (production)
  if (!isDev && !existsSync(projectRoot)) {
    mkdirSync(projectRoot, { recursive: true });
  }
  const configPath = resolve(projectRoot, 'tunnel.config.yaml');
  if (!existsSync(configPath)) {
    // In production, read example from inside the packed asar archive
    const asarRoot = resolve(__dirname, '..', '..');
    const examplePath = resolve(asarRoot, 'tunnel.config.example.yaml');
    if (existsSync(examplePath)) {
      const example = readFileSync(examplePath, 'utf-8');
      writeFileSync(configPath, example, 'utf-8');
    } else {
      // Create minimal config
      const minimal = {
        server: { port: 9000, host: '127.0.0.1', ui: { enabled: true, port: 3000, host: '127.0.0.1' } },
        channels: [],
        settings: { reconnectInterval: 5000, logLevel: 'info', hotReload: true, retry: { maxRetries: 3, retryOn: [429, 502, 503, 504], backoff: 'exponential', baseDelayMs: 1000, maxDelayMs: 10000 } }
      };
      writeFileSync(configPath, yaml.dump(minimal), 'utf-8');
    }
  }
  return configPath;
}

function loadConfig() {
  const configPath = getConfigPath();
  const raw = readFileSync(configPath, 'utf-8');
  return yaml.load(raw) || {};
}

function saveConfig(config) {
  const configPath = getConfigPath();
  // Remove internal fields
  const clean = { ...config };
  delete clean._path;
  writeFileSync(configPath, yaml.dump(clean, { lineWidth: -1, noRefs: true }), 'utf-8');
}

// ─── Tray icon (1x1 px placeholder if no icon file) ──
function createTrayIcon() {
  const iconPath = resolve(__dirname, '..', 'assets', 'tray-icon.png');
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  // Create a 16x16 programmatic icon
  const size = 16;
  const img = nativeImage.createEmpty();
  return img;
}

// ─── Window creation ─────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'AI-Tunnel',
    backgroundColor: '#0f172a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: resolve(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(resolve(__dirname, '..', 'renderer', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (tray && tunnelStatus === 'running') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Tray ────────────────────────────────────────────
function createTray() {
  const icon = createTrayIcon();
  const fallbackIcon = nativeImage.createFromBuffer(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwQAADsEBuJFr7QAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xNkRpr/UAAAB5SURBVDhPxZDRDYAgDERxBEdxFEdxFEdxFEdwBL2GEmhiNP7wkl5K7y4NAPwM0sWMzQnnBbOOfDMYIPM+GPQA0S3gF9CY0gZyT+h0gnYJ3AdYDzB0grYD3AvMnaAhwAm8BWAiLIBEhyxga95IXDH8N8z5PhDR8gBBjT+hKvUHQgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  tray = new Tray(icon.isEmpty() ? fallbackIcon : icon);

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  
  const statusLabel = tunnelStatus === 'running' ? '● Running' :
                      tunnelStatus === 'starting' ? '◐ Starting...' :
                      tunnelStatus === 'error' ? '● Error' :
                      '○ Stopped';

  const contextMenu = Menu.buildFromTemplate([
    { label: `AI-Tunnel - ${statusLabel}`, enabled: false },
    { type: 'separator' },
    {
      label: tunnelStatus === 'running' ? 'Stop Tunnel' : 'Start Tunnel',
      click: () => {
        if (tunnelStatus === 'running') {
          stopTunnel();
        } else {
          startTunnel();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Open Panel',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        stopTunnel();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`AI-Tunnel - ${statusLabel}`);
}

// ─── Tunnel process management ───────────────────────
function startTunnel() {
  if (tunnelProcess) return;

  tunnelStatus = 'starting';
  updateTrayMenu();
  sendToRenderer('tunnel:status', { status: tunnelStatus });

  // Source code lives inside the asar archive; only config is in userData
  const asarRoot = resolve(__dirname, '..', '..');
  const entryFile = resolve(asarRoot, 'src', 'index.mjs');
  const configPath = getConfigPath();

  tunnelProcess = fork(entryFile, [], {
    cwd: isDev ? asarRoot : projectRoot,
    env: {
      ...process.env,
      TUNNEL_CONFIG: configPath,
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  tunnelProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      sendToRenderer('tunnel:log', { level: 'info', message: text, time: new Date().toISOString() });
      // Detect successful startup
      if (text.includes('AI-Tunnel is running')) {
        tunnelStatus = 'running';
        updateTrayMenu();
        sendToRenderer('tunnel:status', { status: tunnelStatus });
      }
    }
  });

  tunnelProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      sendToRenderer('tunnel:log', { level: 'error', message: text, time: new Date().toISOString() });
    }
  });

  tunnelProcess.on('exit', (code) => {
    tunnelProcess = null;
    tunnelStatus = code === 0 ? 'stopped' : 'error';
    updateTrayMenu();
    sendToRenderer('tunnel:status', { status: tunnelStatus, exitCode: code });
  });

  tunnelProcess.on('error', (err) => {
    tunnelProcess = null;
    tunnelStatus = 'error';
    updateTrayMenu();
    sendToRenderer('tunnel:status', { status: tunnelStatus, error: err.message });
  });

  // Give it a moment, if it doesn't exit immediately, mark as running
  setTimeout(() => {
    if (tunnelProcess && tunnelStatus === 'starting') {
      tunnelStatus = 'running';
      updateTrayMenu();
      sendToRenderer('tunnel:status', { status: tunnelStatus });
    }
  }, 3000);
}

function stopTunnel() {
  if (!tunnelProcess) return;
  tunnelProcess.kill('SIGTERM');
  tunnelProcess = null;
  tunnelStatus = 'stopped';
  updateTrayMenu();
  sendToRenderer('tunnel:status', { status: tunnelStatus });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── IPC handlers ────────────────────────────────────

// Config operations
ipcMain.handle('config:load', async () => {
  try {
    return { ok: true, data: loadConfig() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:save', async (_event, config) => {
  try {
    // Check if SSH config changed while tunnel is running
    const oldConfig = loadConfig();
    const sshChanged = tunnelStatus === 'running' &&
      JSON.stringify(oldConfig.ssh || {}) !== JSON.stringify(config.ssh || {});

    saveConfig(config);

    // Auto-restart tunnel if SSH config changed
    if (sshChanged) {
      sendToRenderer('tunnel:log', {
        level: 'info',
        message: 'SSH config changed, restarting tunnel...',
        time: new Date().toISOString(),
      });
      stopTunnel();
      // Brief delay to allow cleanup before restarting
      setTimeout(() => startTunnel(), 500);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  try {
    const raw = readFileSync(result.filePaths[0], 'utf-8');
    const config = yaml.load(raw);
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:export', async (_event, config) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'tunnel.config.yaml',
    filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
  });
  if (result.canceled) return { ok: false, canceled: true };
  try {
    const clean = { ...config };
    delete clean._path;
    writeFileSync(result.filePath, yaml.dump(clean, { lineWidth: -1, noRefs: true }), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Tunnel control
ipcMain.handle('tunnel:start', async () => {
  startTunnel();
  return { ok: true };
});

ipcMain.handle('tunnel:stop', async () => {
  stopTunnel();
  return { ok: true };
});

ipcMain.handle('tunnel:status', async () => {
  return { status: tunnelStatus };
});

// API proxy — fetch from the running tunnel's API server
ipcMain.handle('api:fetch', async (_event, path) => {
  try {
    const config = loadConfig();
    const uiPort = config.server?.ui?.port || 3000;
    const uiHost = config.server?.ui?.host || '127.0.0.1';
    const url = `http://${uiHost}:${uiPort}${path}`;
    
    const response = await fetch(url);
    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Test a key by calling /v1/models on the target URL
ipcMain.handle('key:test', async (_event, targetUrl, key) => {
  try {
    const url = targetUrl.replace(/\/$/, '') + '/v1/models';
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// SSH test (basic connectivity check)
ipcMain.handle('ssh:test', async (_event, sshConfig) => {
  try {
    // We'll do a simple TCP connection test
    const net = await import('net');
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      }, 5000);
      
      socket.connect(sshConfig.port || 22, sshConfig.host, () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ ok: true, message: `Connected to ${sshConfig.host}:${sshConfig.port || 22}` });
      });
      
      socket.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// File picker for SSH key
ipcMain.handle('dialog:openFile', async (_event, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    ...opts,
  });
  if (result.canceled) return { ok: false, canceled: true };
  return { ok: true, path: result.filePaths[0] };
});

// ─── App lifecycle ───────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && tunnelStatus !== 'running') {
    stopTunnel();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopTunnel();
});
