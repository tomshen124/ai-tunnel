import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import SSHTunnel from './pages/SSHTunnel';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import { useConfig } from './hooks/useConfig';
import { useTunnel } from './hooks/useTunnel';

const api = window.electronAPI;

export default function App() {
  const [page, setPage] = useState('dashboard');
  const { config, setConfig, saveConfig, loading, error: configError } = useConfig();
  const { status, logs, start, stop } = useTunnel();
  const [apiData, setApiData] = useState({ channels: [], stats: null, status: null });

  // Poll API data when tunnel is running
  useEffect(() => {
    if (status !== 'running') {
      setApiData({ channels: [], stats: null, status: null });
      return;
    }
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const [chRes, statsRes, statusRes] = await Promise.all([
          api.apiFetch('/api/channels'),
          api.apiFetch('/api/stats'),
          api.apiFetch('/api/status'),
        ]);
        if (active) {
          setApiData({
            channels: chRes.ok ? chRes.data : [],
            stats: statsRes.ok ? statsRes.data : null,
            status: statusRes.ok ? statusRes.data : null,
          });
        }
      } catch (e) {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [status]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <Dashboard config={config} status={status} apiData={apiData} onStart={start} onStop={stop} />;
      case 'channels':
        return <Channels config={config} setConfig={setConfig} saveConfig={saveConfig} apiData={apiData} status={status} />;
      case 'ssh':
        return <SSHTunnel config={config} setConfig={setConfig} saveConfig={saveConfig} />;
      case 'logs':
        return <Logs logs={logs} status={status} />;
      case 'settings':
        return <Settings config={config} setConfig={setConfig} saveConfig={saveConfig} />;
      default:
        return <Dashboard config={config} status={status} apiData={apiData} onStart={start} onStop={stop} />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark-900">
        <div className="text-dark-400 text-lg">Loading configuration...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-dark-900 text-dark-100 overflow-hidden">
      <Sidebar currentPage={page} onNavigate={setPage} tunnelStatus={status} />
      <main className="flex-1 overflow-y-auto">
        {configError && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-2 text-sm">
            Config error: {configError}
          </div>
        )}
        {renderPage()}
      </main>
    </div>
  );
}
