import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Key, Save, Trash2, Check, AlertCircle } from 'lucide-react';

interface ProviderKey {
  enabled: boolean;
  endpoint?: string;
  hasKey: boolean;
  masked: string | null;
}

interface ProviderKeysData {
  provider_keys: Record<string, ProviderKey>;
}

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', logo: 'https://images.seeklogo.com/logo-png/42/2/open-ai-logo-png_seeklogo-428036.png', description: 'GPT-4, GPT-4o, GPT-3.5' },
  { id: 'anthropic', name: 'Anthropic', logo: 'https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/1/anthropic-icon-wii9u8ifrjrd99btrqfgi.png/anthropic-icon-tdvkiqisswbrmtkiygb0ia.png', description: 'Claude 3.5 Sonnet, Claude 3 Opus' },
  { id: 'google', name: 'Google', logo: 'https://www.google.com/favicon.ico', description: 'Gemini 1.5 Pro, Gemini 1.5 Flash' },
  { id: 'groq', name: 'Groq', logo: 'https://groq.com/favicon.ico', description: 'Llama 3.1, Mixtral' },
  { id: 'azure', name: 'Azure OpenAI', logo: 'https://azure.microsoft.com/favicon.ico', description: 'GPT-4, GPT-4o (requires endpoint)' },
  { id: 'mistral', name: 'Mistral', logo: 'https://mistral.ai/favicon.ico', description: 'Mistral Large, Medium, Small' },
  { id: 'cohere', name: 'Cohere', logo: 'https://cohere.com/favicon.ico', description: 'Command R, Command R+' },
];

export function ProviderKeys() {
  const queryClient = useQueryClient();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data, isLoading, error } = useQuery<ProviderKeysData>({
    queryKey: ['provider-keys'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/provider-keys`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch provider keys');
      return res.json();
    },
  });

  const handleEdit = (providerId: string) => {
    const provider = data?.provider_keys?.[providerId];
    setEditingProvider(providerId);
    setApiKey(''); // Don't show the actual key
    setEndpoint(provider?.endpoint || '');
    setEnabled(provider?.enabled ?? true);
    setMessage(null);
  };

  const handleCancel = () => {
    setEditingProvider(null);
    setApiKey('');
    setEndpoint('');
    setMessage(null);
  };

  const handleSave = async (providerId: string) => {
    setSaving(true);
    setMessage(null);

    try {
      const payload: Record<string, { key: string; enabled: boolean; endpoint?: string }> = {
        [providerId]: {
          key: apiKey,
          enabled,
          ...(endpoint ? { endpoint } : {}),
        },
      };

      const res = await fetch(`${API_BASE}/v1/provider-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save provider key');
      }

      setMessage({ type: 'success', text: 'Provider key saved successfully' });
      queryClient.invalidateQueries({ queryKey: ['provider-keys'] });
      setTimeout(() => {
        setEditingProvider(null);
        setApiKey('');
        setMessage(null);
      }, 1500);
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm(`Are you sure you want to remove the ${providerId} API key?`)) return;

    try {
      const res = await fetch(`${API_BASE}/v1/provider-keys/${providerId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) throw new Error('Failed to delete provider key');

      queryClient.invalidateQueries({ queryKey: ['provider-keys'] });
      setMessage({ type: 'success', text: 'Provider key removed' });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to delete' });
    }
  };

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '2px solid var(--border-default)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ color: '#555' }}>Loading provider keys...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: '24px', background: 'var(--bg-pink)', border: '1px solid #dc2626' }}>
        <h2 className="heading-3" style={{ marginBottom: '8px', color: '#991b1b' }}>Error</h2>
        <p style={{ color: '#555' }}>Failed to load provider keys. Make sure you are an admin.</p>
      </div>
    );
  }

  const providerKeys = data?.provider_keys || {};

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 className="heading-1">Provider Keys</h1>
        <p className="text-large" style={{ color: '#555' }}>
          Configure API keys for AI providers. These keys will be used when users make requests through their virtual keys.
        </p>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            background: message.type === 'success' ? 'var(--bg-mint)' : '#fee2e2',
            border: `1px solid ${message.type === 'success' ? 'var(--border-default)' : '#dc2626'}`,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {message.type === 'success' ? <Check size={20} color="#16a34a" /> : <AlertCircle size={20} color="#dc2626" />}
          <span style={{ fontWeight: 600, color: message.type === 'success' ? 'var(--dark)' : '#dc2626' }}>
            {message.text}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gap: '16px' }}>
        {PROVIDERS.map((provider) => {
          const config = providerKeys[provider.id];
          const isEditing = editingProvider === provider.id;
          const hasKey = config?.hasKey;
          const isEnabled = config?.enabled ?? false;

          return (
            <div
              key={provider.id}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                border: isEnabled && hasKey ? '2px solid var(--accent-green)' : '1px solid var(--border-default)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <img
                  src={provider.logo}
                  alt={provider.name}
                  style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover' }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{provider.name}</h3>
                    {hasKey && (
                      <span
                        style={{
                          padding: '4px 8px',
                          background: isEnabled ? 'var(--accent-green)' : 'var(--bg-pink)',
                          color: isEnabled ? 'var(--dark)' : '#991b1b',
                          fontSize: '12px',
                          fontWeight: 600,
                          borderRadius: '4px',
                        }}
                      >
                        {isEnabled ? 'Active' : 'Disabled'}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#555' }}>
                    {provider.description}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {!isEditing && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleEdit(provider.id)}
                      >
                        <Key size={16} />
                        {hasKey ? 'Update' : 'Add Key'}
                      </button>
                      {hasKey && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleDelete(provider.id)}
                          style={{ color: '#dc2626' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {hasKey && !isEditing && config?.masked && (
                <div style={{ fontSize: '14px', color: '#666', fontFamily: 'monospace' }}>
                  Key: {config.masked}
                </div>
              )}

              {isEditing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                      API Key
                    </label>
                    <input
                      type="password"
                      className="input"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={hasKey ? '•••••••• (leave blank to keep existing)' : 'Enter API key'}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {provider.id === 'azure' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                        Endpoint URL
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                        placeholder="https://your-resource.openai.azure.com/"
                        style={{ width: '100%' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      id={`enabled-${provider.id}`}
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <label htmlFor={`enabled-${provider.id}`} style={{ fontSize: '14px' }}>
                      Enable this provider for users
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleSave(provider.id)}
                      disabled={saving || (!apiKey && !hasKey)}
                    >
                      <Save size={16} />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={handleCancel}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: '32px', background: 'var(--bg-cream)' }}>
        <h3 style={{ marginBottom: '12px' }}>How it works</h3>
        <ul style={{ color: '#555', lineHeight: 1.6, margin: 0, paddingLeft: '20px' }}>
          <li>Add API keys for the providers you want to use (OpenAI, Anthropic, etc.)</li>
          <li>Users will only see models from providers you've configured</li>
          <li>When users make requests with their virtual keys, we'll use your configured provider keys</li>
          <li>You can enable/disable providers at any time without affecting virtual keys</li>
          <li>API keys are encrypted before being stored in the database</li>
        </ul>
      </div>
    </div>
  );
}
