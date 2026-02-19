import { useState, useEffect, useCallback, useRef } from 'react';

const api = window.electronAPI;

export function useTunnel() {
  const [status, setStatus] = useState('stopped');
  const [logs, setLogs] = useState([]);
  const maxLogs = 500;

  useEffect(() => {
    // Get initial status
    api.getTunnelStatus().then((res) => {
      setStatus(res.status);
    });

    // Listen for status changes
    const unsubStatus = api.onTunnelStatus((data) => {
      setStatus(data.status);
    });

    const unsubLog = api.onTunnelLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > maxLogs ? next.slice(-maxLogs) : next;
      });
    });

    return () => {
      unsubStatus();
      unsubLog();
    };
  }, []);

  const start = useCallback(async () => {
    setLogs([]);
    return api.startTunnel();
  }, []);

  const stop = useCallback(async () => {
    return api.stopTunnel();
  }, []);

  return { status, logs, start, stop };
}
