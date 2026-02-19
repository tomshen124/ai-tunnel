import React from 'react';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'channels', label: 'Channels', icon: ChannelsIcon },
  { id: 'ssh', label: 'SSH Tunnel', icon: SSHIcon },
  { id: 'logs', label: 'Logs', icon: LogsIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function Sidebar({ currentPage, onNavigate, tunnelStatus }) {
  const statusColor = tunnelStatus === 'running' ? 'bg-green-500' :
                      tunnelStatus === 'starting' ? 'bg-yellow-500' :
                      tunnelStatus === 'error' ? 'bg-red-500' :
                      'bg-dark-600';

  return (
    <aside className="w-56 bg-dark-950 border-r border-dark-800 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-dark-800">
        <div className="text-2xl">🚇</div>
        <div>
          <div className="font-bold text-sm text-dark-100">AI-Tunnel</div>
          <div className="text-xs text-dark-500">v2.0.0</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-all
              ${currentPage === item.id
                ? 'bg-dark-800 text-blue-400 border-r-2 border-blue-400'
                : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800/50'
              }`}
          >
            <item.icon className="w-4 h-4" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Status */}
      <div className="p-4 border-t border-dark-800">
        <div className="flex items-center gap-2 text-xs text-dark-500">
          <div className={`w-2 h-2 rounded-full ${statusColor} ${tunnelStatus === 'running' ? 'animate-pulse-green' : ''}`} />
          <span className="capitalize">{tunnelStatus}</span>
        </div>
      </div>
    </aside>
  );
}

// Simple inline SVG icons (avoid extra dependencies)
function DashboardIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ChannelsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h.01" /><path d="M7 20v-4" /><path d="M12 20v-8" /><path d="M17 20V8" /><path d="M22 4v16" />
    </svg>
  );
}

function SSHIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M7 15l3-3-3-3" /><path d="M13 15h4" />
    </svg>
  );
}

function LogsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
