import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const api = window.electronAPI;

export default function SSHTunnel({ config, setConfig, saveConfig }) {
  const { t } = useTranslation();
  const ssh = config?.ssh || {};
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  function updateSSH(field, value) {
    const newSSH = { ...ssh, [field]: value };
    setConfig({ ...config, ssh: newSSH });
    setSaveStatus(null);
  }

  async function save() {
    try {
      const result = await saveConfig(config);
      if (result?.ok) {
        setSaveStatus({ ok: true, message: t('ssh.saved') });
      } else {
        setSaveStatus({ ok: false, message: result?.error || t('ssh.saveFailed') });
      }
    } catch (err) {
      setSaveStatus({ ok: false, message: err.message || t('ssh.saveFailed') });
    }
    setTimeout(() => setSaveStatus(null), 3000);
  }

  async function testConnection() {
    if (!ssh.host) return;
    setTesting(true);
    setTestResult(null);
    const result = await api.testSSH({ host: ssh.host, port: ssh.port || 22 });
    setTestResult(result);
    setTesting(false);
  }

  async function browseKeyFile() {
    const result = await api.openFileDialog({
      title: 'Select SSH Private Key',
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.ok) {
      updateSSH('privateKeyPath', result.path);
    }
  }

  const tunnelChannels = (config?.channels || []).filter(ch => ch.tunnel?.enabled);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">{t('ssh.title')}</h1>

      <div className="bg-dark-800 rounded-lg border border-dark-700 p-5 space-y-4">
        <h2 className="text-sm font-medium text-dark-300 uppercase tracking-wider">{t('ssh.connectionSettings')}</h2>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="block text-xs text-dark-400 mb-1.5">{t('ssh.host')}</label>
            <input
              type="text"
              value={ssh.host || ''}
              onChange={e => updateSSH('host', e.target.value)}
              placeholder="your-vps-ip"
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">{t('ssh.port')}</label>
            <input
              type="number"
              value={ssh.port || 22}
              onChange={e => updateSSH('port', parseInt(e.target.value) || 22)}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-dark-400 mb-1.5">{t('ssh.username')}</label>
          <input
            type="text"
            value={ssh.username || ''}
            onChange={e => updateSSH('username', e.target.value)}
            placeholder="root"
            className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-dark-400 mb-1.5">{t('ssh.authentication')}</label>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-dark-500 mb-1">{t('ssh.privateKeyPath')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={ssh.privateKeyPath || ''}
                  onChange={e => updateSSH('privateKeyPath', e.target.value)}
                  placeholder="~/.ssh/id_rsa"
                  className="flex-1 bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={browseKeyFile}
                  className="px-3 py-2 text-sm bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-md text-dark-300"
                >
                  {t('ssh.browse')}
                </button>
              </div>
            </div>
            <div className="text-center text-xs text-dark-500">{t('ssh.or')}</div>
            <div>
              <label className="block text-xs text-dark-500 mb-1">{t('ssh.password')}</label>
              <input
                type="password"
                value={ssh.password || ''}
                onChange={e => updateSSH('password', e.target.value)}
                placeholder={t('ssh.passwordPlaceholder')}
                className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={testConnection}
            disabled={!ssh.host || testing}
            className="px-4 py-2 text-sm bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-md text-dark-300 disabled:opacity-50"
          >
            {testing ? t('ssh.testing') : t('ssh.testConnection')}
          </button>
          <button
            onClick={save}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-md text-white"
          >
            {t('ssh.save')}
          </button>
          {saveStatus && (
            <span className={`text-sm ${saveStatus.ok ? 'text-green-400' : 'text-red-400'}`}>
              {saveStatus.ok ? `✓ ${saveStatus.message}` : `✕ ${saveStatus.message}`}
            </span>
          )}
          {testResult && (
            <span className={`text-sm ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.ok ? `✓ ${testResult.message}` : `✕ ${testResult.error}`}
            </span>
          )}
        </div>
      </div>

      {tunnelChannels.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">{t('ssh.tunnelPortMappings')}</h2>
          <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dark-400 text-xs uppercase border-b border-dark-700">
                  <th className="text-left px-4 py-3">{t('ssh.channel')}</th>
                  <th className="text-center px-4 py-3">{t('ssh.remotePort')}</th>
                  <th className="text-center px-4 py-3"></th>
                  <th className="text-center px-4 py-3">{t('ssh.localProxy')}</th>
                </tr>
              </thead>
              <tbody>
                {tunnelChannels.map((ch, i) => (
                  <tr key={i} className="border-b border-dark-700/50">
                    <td className="px-4 py-3 font-medium">{ch.name}</td>
                    <td className="px-4 py-3 text-center text-dark-300">VPS:{ch.tunnel.remotePort}</td>
                    <td className="px-4 py-3 text-center text-dark-500">→</td>
                    <td className="px-4 py-3 text-center text-dark-300">proxy:{config?.server?.port || 9000}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-dark-500 mt-2">
            {t('ssh.portMappingsNote')}
          </p>
        </div>
      )}

      {tunnelChannels.length === 0 && (
        <div className="mt-6 bg-dark-800/50 rounded-lg border border-dark-700 p-6 text-center">
          <div className="text-dark-400 text-sm">
            {t('ssh.noTunnelChannels')}
          </div>
        </div>
      )}
    </div>
  );
}
