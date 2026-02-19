import React from 'react';

export default function Dashboard({ config, status, apiData, onStart, onStop }) {
  const isRunning = status === 'running';
  const isStarting = status === 'starting';
  const channelCount = config?.channels?.length || 0;
  const apiChannels = apiData.channels || [];
  const healthy = apiChannels.filter(c => c.health === 'healthy').length;
  const unhealthy = apiChannels.filter(c => c.health === 'unhealthy').length;
  const stats = apiData.stats;

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Big Start/Stop Button */}
      <div className="flex items-center gap-6 mb-8">
        <button
          onClick={isRunning ? onStop : onStart}
          disabled={isStarting}
          className={`
            relative w-28 h-28 rounded-full flex items-center justify-center text-white text-lg font-bold
            transition-all duration-300 shadow-lg
            ${isRunning
              ? 'bg-red-600 hover:bg-red-500 shadow-red-900/30'
              : isStarting
                ? 'bg-yellow-600 cursor-wait shadow-yellow-900/30'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
            }
            ${isRunning ? 'hover:scale-105' : isStarting ? '' : 'hover:scale-105'}
          `}
        >
          {isRunning ? (
            <div className="flex flex-col items-center">
              <StopIcon className="w-8 h-8 mb-1" />
              <span className="text-xs">Stop</span>
            </div>
          ) : isStarting ? (
            <div className="flex flex-col items-center">
              <SpinnerIcon className="w-8 h-8 mb-1 animate-spin" />
              <span className="text-xs">Starting</span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <PlayIcon className="w-8 h-8 mb-1" />
              <span className="text-xs">Start</span>
            </div>
          )}
          {isRunning && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full animate-pulse-green" />
          )}
        </button>

        <div>
          <div className="text-xl font-semibold">
            {isRunning ? 'Tunnel is Running' : isStarting ? 'Starting Tunnel...' : 'Tunnel is Stopped'}
          </div>
          <div className="text-dark-400 text-sm mt-1">
            {isRunning && apiData.status
              ? `Uptime: ${formatUptime(apiData.status.uptime)} · Port ${config?.server?.port || 9000}`
              : isRunning
                ? `Listening on port ${config?.server?.port || 9000}`
                : 'Click the button to start the tunnel service'
            }
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Channels"
          value={isRunning ? `${healthy}/${apiChannels.length}` : `${channelCount}`}
          sub={isRunning ? 'healthy' : 'configured'}
          color="blue"
        />
        <StatCard
          label="Total Requests"
          value={stats ? formatNumber(stats.totalRequests) : '—'}
          sub={isRunning ? 'since start' : 'not running'}
          color="cyan"
        />
        <StatCard
          label="Success Rate"
          value={stats && stats.totalRequests > 0
            ? `${((stats.totalSuccess / stats.totalRequests) * 100).toFixed(1)}%`
            : '—'}
          sub={stats ? `${stats.totalSuccess} ok / ${stats.totalFail} fail` : ''}
          color="emerald"
        />
        <StatCard
          label="Failures"
          value={stats ? formatNumber(stats.totalFail) : '—'}
          sub={unhealthy > 0 ? `${unhealthy} unhealthy channels` : 'all good'}
          color={unhealthy > 0 ? 'red' : 'emerald'}
        />
      </div>

      {/* Channel Status Table */}
      {isRunning && apiChannels.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Channel Status</h2>
          <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dark-400 text-xs uppercase border-b border-dark-700">
                  <th className="text-left px-4 py-3">Channel</th>
                  <th className="text-left px-4 py-3">Health</th>
                  <th className="text-right px-4 py-3">Latency</th>
                  <th className="text-right px-4 py-3">Requests</th>
                  <th className="text-right px-4 py-3">Success Rate</th>
                  <th className="text-center px-4 py-3">Keys</th>
                  <th className="text-center px-4 py-3">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {apiChannels.map((ch) => (
                  <tr key={ch.name} className="border-b border-dark-700/50 hover:bg-dark-700/30">
                    <td className="px-4 py-3 font-medium">
                      {ch.name}
                      {ch.fallback && <span className="ml-2 text-xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">fallback</span>}
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge health={ch.health} />
                    </td>
                    <td className="px-4 py-3 text-right text-dark-300">
                      {ch.latency != null ? `${ch.latency}ms` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-dark-300">
                      {ch.stats?.totalRequests ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right text-dark-300">
                      {ch.stats?.totalRequests > 0
                        ? `${((ch.stats.successCount / ch.stats.totalRequests) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-dark-300">
                      {ch.keys?.alive}/{ch.keys?.total}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${ch.enabled ? 'bg-green-500' : 'bg-dark-600'}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state when not running */}
      {!isRunning && channelCount === 0 && (
        <div className="bg-dark-800/50 rounded-lg border border-dark-700 p-8 text-center">
          <div className="text-4xl mb-3">🚀</div>
          <div className="text-dark-300 mb-2">No channels configured yet</div>
          <div className="text-dark-500 text-sm">Go to the Channels page to add your first API channel</div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  const colorClasses = {
    blue: 'border-blue-800/50 text-blue-400',
    cyan: 'border-cyan-800/50 text-cyan-400',
    emerald: 'border-emerald-800/50 text-emerald-400',
    red: 'border-red-800/50 text-red-400',
  };
  return (
    <div className={`bg-dark-800 rounded-lg border ${colorClasses[color] || colorClasses.blue} p-4`}>
      <div className="text-dark-400 text-xs uppercase mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colorClasses[color]?.split(' ')[1] || 'text-blue-400'}`}>{value}</div>
      <div className="text-dark-500 text-xs mt-1">{sub}</div>
    </div>
  );
}

function HealthBadge({ health }) {
  const styles = {
    healthy: 'bg-green-500/10 text-green-400 border-green-800/50',
    unhealthy: 'bg-red-500/10 text-red-400 border-red-800/50',
    unknown: 'bg-dark-700 text-dark-400 border-dark-600',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border ${styles[health] || styles.unknown}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        health === 'healthy' ? 'bg-green-400' :
        health === 'unhealthy' ? 'bg-red-400' : 'bg-dark-500'
      }`} />
      {health || 'unknown'}
    </span>
  );
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

function PlayIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

function SpinnerIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
