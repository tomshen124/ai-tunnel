import { useState, useEffect, useCallback } from 'react';

const api = window.electronAPI;

export function useConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const result = await api.loadConfig();
      if (result.ok) {
        setConfig(result.data);
      } else {
        setError(result.error);
        // Set empty default config
        setConfig({
          server: { port: 9000, host: '127.0.0.1', ui: { enabled: true, port: 3000, host: '127.0.0.1' } },
          channels: [],
          settings: { reconnectInterval: 5000, logLevel: 'info', hotReload: true, retry: { maxRetries: 3, retryOn: [429, 502, 503, 504], backoff: 'exponential', baseDelayMs: 1000, maxDelayMs: 10000 } },
        });
      }
      setLoading(false);
    })();
  }, []);

  const saveConfig = useCallback(async (newConfig) => {
    const toSave = newConfig || config;
    const result = await api.saveConfig(toSave);
    if (!result.ok) {
      setError(result.error);
    } else {
      setError(null);
    }
    return result;
  }, [config]);

  return { config, setConfig, saveConfig, loading, error };
}
