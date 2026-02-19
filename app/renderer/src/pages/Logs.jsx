import React, { useEffect, useRef } from 'react';

export default function Logs({ logs, status }) {
  const containerRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }

  const levelColors = {
    info: 'text-cyan-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
    debug: 'text-dark-500',
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Logs</h1>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${status === 'running' ? 'text-green-400' : 'text-dark-500'}`}>
            {status === 'running' ? '● Live' : '○ Tunnel stopped'}
          </span>
          <span className="text-xs text-dark-500">{logs.length} entries</span>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 bg-dark-950 rounded-lg border border-dark-700 p-4 overflow-y-auto log-terminal"
      >
        {logs.length === 0 ? (
          <div className="text-dark-500 text-center py-8">
            {status === 'running'
              ? 'Waiting for log output...'
              : 'Start the tunnel to see logs'}
          </div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-relaxed hover:bg-dark-800/30 px-1">
              <span className="text-dark-600 shrink-0">
                {entry.time ? new Date(entry.time).toLocaleTimeString('en-US', { hour12: false }) : ''}
              </span>
              <span className={`shrink-0 ${levelColors[entry.level] || 'text-dark-400'}`}>
                [{(entry.level || 'info').toUpperCase().padEnd(5)}]
              </span>
              <span className="text-dark-200 break-all">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
