// app/preload/index.mjs - Preload script exposing safe IPC API to renderer
// Note: Despite .mjs extension, Electron preload with contextIsolation
// uses require() for electron modules. We rename to .cjs for clarity.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  importConfig: () => ipcRenderer.invoke('config:import'),
  exportConfig: (config) => ipcRenderer.invoke('config:export', config),

  // Tunnel control
  startTunnel: () => ipcRenderer.invoke('tunnel:start'),
  stopTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  getTunnelStatus: () => ipcRenderer.invoke('tunnel:status'),

  // API proxy
  apiFetch: (path) => ipcRenderer.invoke('api:fetch', path),

  // Key testing
  testKey: (targetUrl, key) => ipcRenderer.invoke('key:test', targetUrl, key),

  // SSH testing
  testSSH: (sshConfig) => ipcRenderer.invoke('ssh:test', sshConfig),

  // File dialog
  openFileDialog: (opts) => ipcRenderer.invoke('dialog:openFile', opts),

  // Event listeners
  onTunnelStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('tunnel:status', handler);
    return () => ipcRenderer.removeListener('tunnel:status', handler);
  },
  onTunnelLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('tunnel:log', handler);
    return () => ipcRenderer.removeListener('tunnel:log', handler);
  },
});
