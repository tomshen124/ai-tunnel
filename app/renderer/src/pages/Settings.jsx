import React, { useState } from 'react';

const api = window.electronAPI;

export default function Settings({ config, setConfig, saveConfig }) {
  const [importResult, setImportResult] = useState(null);
  const [exportResult, setExportResult] = useState(null);

  const server = config?.server || {};
  const settings = config?.settings || {};
  const retry = settings.retry || {};

  function updateServer(path, value) {
    const newServer = { ...server };
    const parts = path.split('.');
    let obj = newServer;
    for (let i = 0; i < parts.length - 1; i++) {
      obj[parts[i]] = obj[parts[i]] || {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    setConfig({ ...config, server: newServer });
  }

  function updateSettings(field, value) {
    setConfig({ ...config, settings: { ...settings, [field]: value } });
  }

  function updateRetry(field, value) {
    setConfig({
      ...config,
      settings: { ...settings, retry: { ...retry, [field]: value } },
    });
  }

  async function save() {
    await saveConfig(config);
  }

  async function handleImport() {
    setImportResult(null);
    const result = await api.importConfig();
    if (result.canceled) return;
    if (result.ok) {
      setConfig(result.data);
      await saveConfig(result.data);
      setImportResult({ ok: true, message: 'Config imported successfully' });
    } else {
      setImportResult({ ok: false, message: result.error });
    }
  }

  async function handleExport() {
    setExportResult(null);
    const result = await api.exportConfig(config);
    if (result.canceled) return;
    if (result.ok) {
      setExportResult({ ok: true, message: 'Config exported successfully' });
    } else {
      setExportResult({ ok: false, message: result.error });
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Server settings */}
      <Section title="Server">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Proxy Port</label>
            <input
              type="number"
              value={server.port || 9000}
              onChange={e => updateServer('port', parseInt(e.target.value) || 9000)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Proxy Host</label>
            <input
              type="text"
              value={server.host || '127.0.0.1'}
              onChange={e => updateServer('host', e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Web UI Port</label>
            <input
              type="number"
              value={server.ui?.port || 3000}
              onChange={e => updateServer('ui.port', parseInt(e.target.value) || 3000)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Web UI Host</label>
            <input
              type="text"
              value={server.ui?.host || '127.0.0.1'}
              onChange={e => updateServer('ui.host', e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </Section>

      {/* Global settings */}
      <Section title="General">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Log Level</label>
            <select
              value={settings.logLevel || 'info'}
              onChange={e => updateSettings('logLevel', e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Reconnect Interval (ms)</label>
            <input
              type="number"
              value={settings.reconnectInterval || 5000}
              onChange={e => updateSettings('reconnectInterval', parseInt(e.target.value) || 5000)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.hotReload !== false}
              onChange={e => updateSettings('hotReload', e.target.checked)}
              className="rounded bg-dark-900 border-dark-600"
            />
            <span className="text-sm text-dark-300">Hot Reload (auto-reload config on file change)</span>
          </label>
        </div>
      </Section>

      {/* Retry settings */}
      <Section title="Retry">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Max Retries</label>
            <input
              type="number"
              value={retry.maxRetries ?? 3}
              onChange={e => updateRetry('maxRetries', parseInt(e.target.value) || 3)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Backoff Strategy</label>
            <select
              value={retry.backoff || 'exponential'}
              onChange={e => updateRetry('backoff', e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="exponential">Exponential</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Base Delay (ms)</label>
            <input
              type="number"
              value={retry.baseDelayMs ?? 1000}
              onChange={e => updateRetry('baseDelayMs', parseInt(e.target.value) || 1000)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Max Delay (ms)</label>
            <input
              type="number"
              value={retry.maxDelayMs ?? 10000}
              onChange={e => updateRetry('maxDelayMs', parseInt(e.target.value) || 10000)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </Section>

      {/* Import/Export */}
      <Section title="Config Import / Export">
        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            className="px-4 py-2 text-sm bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-md text-dark-300"
          >
            Import YAML
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-md text-dark-300"
          >
            Export YAML
          </button>
          {importResult && (
            <span className={`text-sm ${importResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {importResult.message}
            </span>
          )}
          {exportResult && (
            <span className={`text-sm ${exportResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {exportResult.message}
            </span>
          )}
        </div>
      </Section>

      {/* Save button */}
      <div className="mt-6">
        <button
          onClick={save}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium"
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-medium text-dark-300 uppercase tracking-wider mb-3">{title}</h2>
      <div className="bg-dark-800 rounded-lg border border-dark-700 p-5">
        {children}
      </div>
    </div>
  );
}
