import React, { useState } from 'react';

const api = window.electronAPI;

const emptyChannel = {
  name: '',
  target: '',
  keys: [],
  keyStrategy: 'round-robin',
  weight: 10,
  fallback: false,
  tunnel: { enabled: false, localPort: 8080, remotePort: 9090 },
  healthCheck: { path: '/v1/models', intervalMs: 60000, timeoutMs: 5000 },
};

export default function Channels({ config, setConfig, saveConfig, apiData, status }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [editChannel, setEditChannel] = useState(null);
  const [newKeyValue, setNewKeyValue] = useState('');
  const [testingKey, setTestingKey] = useState(null); // index of key being tested
  const [keyTestResult, setKeyTestResult] = useState({}); // { index: { ok, message } }

  const channels = config?.channels || [];
  const isRunning = status === 'running';

  function startEdit(index) {
    if (index === -1) {
      // New channel
      setEditChannel({ ...emptyChannel, keys: [] });
    } else {
      setEditChannel(JSON.parse(JSON.stringify(channels[index])));
    }
    setEditingIndex(index);
    setNewKeyValue('');
    setKeyTestResult({});
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditChannel(null);
  }

  async function saveChannel() {
    if (!editChannel.name || !editChannel.target) return;
    if (!editChannel.keys || editChannel.keys.length === 0) {
      // Allow save with no keys (user might add later)
    }

    const newChannels = [...channels];
    if (editingIndex === -1) {
      newChannels.push(editChannel);
    } else {
      newChannels[editingIndex] = editChannel;
    }

    const newConfig = { ...config, channels: newChannels };
    setConfig(newConfig);
    await saveConfig(newConfig);
    setEditingIndex(null);
    setEditChannel(null);
  }

  async function deleteChannel(index) {
    const ch = channels[index];
    if (!confirm(`Delete channel "${ch.name}"?`)) return;
    const newChannels = channels.filter((_, i) => i !== index);
    const newConfig = { ...config, channels: newChannels };
    setConfig(newConfig);
    await saveConfig(newConfig);
    if (editingIndex === index) cancelEdit();
  }

  function addKey() {
    if (!newKeyValue.trim()) return;
    const updated = { ...editChannel, keys: [...(editChannel.keys || []), newKeyValue.trim()] };
    setEditChannel(updated);
    setNewKeyValue('');
  }

  function removeKey(ki) {
    const updated = { ...editChannel, keys: editChannel.keys.filter((_, i) => i !== ki) };
    setEditChannel(updated);
    // Clear test result for removed key
    const newResults = { ...keyTestResult };
    delete newResults[ki];
    setKeyTestResult(newResults);
  }

  async function testKey(ki) {
    setTestingKey(ki);
    const result = await api.testKey(editChannel.target, editChannel.keys[ki]);
    setKeyTestResult(prev => ({
      ...prev,
      [ki]: result.ok
        ? { ok: true, message: `OK (${result.data?.data?.length || 0} models)` }
        : { ok: false, message: result.error || `HTTP ${result.status}` }
    }));
    setTestingKey(null);
  }

  // Get live status for a channel
  function getLiveStatus(name) {
    if (!isRunning) return null;
    return apiData.channels?.find(c => c.name === name) || null;
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Channels</h1>
        <button
          onClick={() => startEdit(-1)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <PlusIcon className="w-4 h-4" /> Add Channel
        </button>
      </div>

      {/* Channel Cards */}
      <div className="space-y-3">
        {channels.length === 0 && editingIndex !== -1 && (
          <div className="bg-dark-800/50 rounded-lg border border-dark-700 p-8 text-center">
            <div className="text-4xl mb-3">📡</div>
            <div className="text-dark-300 mb-2">No channels configured</div>
            <div className="text-dark-500 text-sm">Click "Add Channel" to create your first API channel</div>
          </div>
        )}

        {channels.map((ch, i) => {
          const live = getLiveStatus(ch.name);
          const isEditing = editingIndex === i;

          return (
            <div key={i} className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
              {/* Channel Header (collapsed view) */}
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-dark-700/30"
                onClick={() => isEditing ? cancelEdit() : startEdit(i)}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    live?.health === 'healthy' ? 'bg-green-500' :
                    live?.health === 'unhealthy' ? 'bg-red-500' :
                    'bg-dark-600'
                  }`} />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {ch.name}
                      {ch.fallback && (
                        <span className="text-xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">fallback</span>
                      )}
                    </div>
                    <div className="text-xs text-dark-500 mt-0.5">{ch.target}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-dark-400">
                  <span>{ch.keys?.length || 0} keys</span>
                  <span>w:{ch.weight || 10}</span>
                  {live && <span className="text-dark-500">{live.latency != null ? `${live.latency}ms` : ''}</span>}
                  <ChevronIcon className={`w-4 h-4 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Expanded Edit Form */}
              {isEditing && editChannel && (
                <ChannelEditForm
                  channel={editChannel}
                  setChannel={setEditChannel}
                  newKeyValue={newKeyValue}
                  setNewKeyValue={setNewKeyValue}
                  onAddKey={addKey}
                  onRemoveKey={removeKey}
                  onTestKey={testKey}
                  testingKey={testingKey}
                  keyTestResult={keyTestResult}
                  onSave={saveChannel}
                  onCancel={cancelEdit}
                  onDelete={() => deleteChannel(i)}
                  isNew={false}
                />
              )}
            </div>
          );
        })}

        {/* New channel form */}
        {editingIndex === -1 && editChannel && (
          <div className="bg-dark-800 rounded-lg border border-blue-700/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-dark-700 bg-blue-900/10">
              <span className="text-sm font-medium text-blue-400">New Channel</span>
            </div>
            <ChannelEditForm
              channel={editChannel}
              setChannel={setEditChannel}
              newKeyValue={newKeyValue}
              setNewKeyValue={setNewKeyValue}
              onAddKey={addKey}
              onRemoveKey={removeKey}
              onTestKey={testKey}
              testingKey={testingKey}
              keyTestResult={keyTestResult}
              onSave={saveChannel}
              onCancel={cancelEdit}
              isNew={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelEditForm({
  channel, setChannel,
  newKeyValue, setNewKeyValue,
  onAddKey, onRemoveKey, onTestKey,
  testingKey, keyTestResult,
  onSave, onCancel, onDelete,
  isNew,
}) {
  const update = (field, value) => {
    setChannel(prev => ({ ...prev, [field]: value }));
  };

  const updateTunnel = (field, value) => {
    setChannel(prev => ({
      ...prev,
      tunnel: { ...(prev.tunnel || {}), [field]: value },
    }));
  };

  return (
    <div className="p-5 space-y-4 border-t border-dark-700">
      {/* Basic fields */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Name</label>
          <input
            type="text"
            value={channel.name}
            onChange={e => update('name', e.target.value)}
            placeholder="my-channel"
            className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Target URL</label>
          <input
            type="text"
            value={channel.target}
            onChange={e => update('target', e.target.value)}
            placeholder="https://api.example.com"
            className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Weight</label>
          <input
            type="number"
            value={channel.weight ?? 10}
            onChange={e => update('weight', parseInt(e.target.value) || 10)}
            className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Key Strategy</label>
          <select
            value={channel.keyStrategy || 'round-robin'}
            onChange={e => update('keyStrategy', e.target.value)}
            className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="round-robin">Round Robin</option>
            <option value="random">Random</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={channel.fallback || false}
              onChange={e => update('fallback', e.target.checked)}
              className="rounded bg-dark-900 border-dark-600"
            />
            <span className="text-sm text-dark-300">Fallback channel</span>
          </label>
        </div>
      </div>

      {/* Tunnel config */}
      <div>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={channel.tunnel?.enabled || false}
            onChange={e => updateTunnel('enabled', e.target.checked)}
            className="rounded bg-dark-900 border-dark-600"
          />
          <span className="text-sm text-dark-300">SSH Tunnel</span>
        </label>
        {channel.tunnel?.enabled && (
          <div className="grid grid-cols-2 gap-4 ml-6">
            <div>
              <label className="block text-xs text-dark-400 mb-1">Local Port</label>
              <input
                type="number"
                value={channel.tunnel.localPort || ''}
                onChange={e => updateTunnel('localPort', parseInt(e.target.value) || 0)}
                className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-dark-400 mb-1">Remote Port</label>
              <input
                type="number"
                value={channel.tunnel.remotePort || ''}
                onChange={e => updateTunnel('remotePort', parseInt(e.target.value) || 0)}
                className="w-full bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Keys section */}
      <div>
        <label className="block text-xs text-dark-400 mb-2">API Keys ({channel.keys?.length || 0})</label>
        <div className="space-y-2">
          {(channel.keys || []).map((key, ki) => (
            <div key={ki} className="flex items-center gap-2">
              <div className="flex-1 bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm font-mono text-dark-300 truncate">
                {maskKey(key)}
              </div>
              <button
                onClick={() => onTestKey(ki)}
                disabled={testingKey === ki || !channel.target}
                className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-md text-dark-300 disabled:opacity-50"
              >
                {testingKey === ki ? '...' : 'Test'}
              </button>
              <button
                onClick={() => onRemoveKey(ki)}
                className="px-2 py-2 text-xs bg-dark-700 hover:bg-red-900/50 border border-dark-600 rounded-md text-dark-400 hover:text-red-400"
              >
                ✕
              </button>
              {keyTestResult[ki] && (
                <span className={`text-xs ${keyTestResult[ki].ok ? 'text-green-400' : 'text-red-400'}`}>
                  {keyTestResult[ki].message}
                </span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyValue}
              onChange={e => setNewKeyValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onAddKey()}
              placeholder="sk-..."
              className="flex-1 bg-dark-900 border border-dark-600 rounded-md px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={onAddKey}
              disabled={!newKeyValue.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-md text-white disabled:opacity-50"
            >
              Add Key
            </button>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-dark-700">
        <div>
          {!isNew && onDelete && (
            <button
              onClick={onDelete}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Delete Channel
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!channel.name || !channel.target}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-md text-white disabled:opacity-50"
          >
            {isNew ? 'Create Channel' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 12) return key.slice(0, 4) + '****';
  return key.slice(0, 6) + '****' + key.slice(-4);
}

function PlusIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
