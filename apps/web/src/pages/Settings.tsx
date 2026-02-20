import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Key, Trash2, User, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { AIGateway } from './AIGateway';
import { Billing } from './Billing';
import { SpanLogs } from './SpanLogs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

interface MeUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role?: string;
}

interface ApiTokenItem {
  id: string;
  name: string;
  token?: string;
  token_preview?: string;
  scopes: string[];
  created_at: string;
  last_used: string | null;
  user_id: string | null;
  team_id?: string | null;
}

interface Team {
  id: string;
  name: string;
}

interface AiGatewayKey {
  id: string;
  key_hash: string;
  name: string;
  customer_id: string;
  user_id: string | null;
  budget_usd: string | null;
  spend_usd: string;
  budget_reset: string | null;
  created_at: string;
}

interface GatewayInfo {
  cf_gateway_id: string | null;
  cf_account_id: string | null;
  otel?: Array<{ url: string; authorization?: string; headers?: Record<string, string> }> | null;
}

const DEFAULT_OTEL_URL = `${API_BASE}/v1/traces`;

export function Settings() {
  const [meUser, setMeUser] = useState<MeUser | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [tokens, setTokens] = useState<ApiTokenItem[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokensError, setTokensError] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [aiGatewayKeys, setAiGatewayKeys] = useState<AiGatewayKey[]>([]);
  const [aiGatewayKeysLoading, setAiGatewayKeysLoading] = useState(true);
  const [aiGatewayKeysError, setAiGatewayKeysError] = useState('');
  const [settingsTab, setSettingsTab] = useState<'user' | 'gateway'>('user');
  const [gatewayTab, setGatewayTab] = useState<'span-logs' | 'ai-gateway' | 'billing' | 'destinations'>('ai-gateway');
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [gatewayInfoLoading, setGatewayInfoLoading] = useState(true);
  const [gatewayInfoError, setGatewayInfoError] = useState('');
  const [otelUrls, setOtelUrls] = useState<string[]>([DEFAULT_OTEL_URL]);
  const [otelSaving, setOtelSaving] = useState(false);
  const [otelMessage, setOtelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAiGatewayKeys = async () => {
    setAiGatewayKeysLoading(true);
    setAiGatewayKeysError('');
    try {
      const res = await fetch(`${API_BASE}/v1/ai/keys/user`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch AI keys');
      setAiGatewayKeys(data.keys ?? []);
    } catch (e) {
      setAiGatewayKeysError(e instanceof Error ? e.message : 'Failed to fetch AI keys');
    } finally {
      setAiGatewayKeysLoading(false);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setMeUser(data.user);
          setProfileImageUrl(data.user.image ?? '');
        }
        setMeLoading(false);
      })
      .catch(() => setMeLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/v1/teams`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.teams) setTeams(data.teams);
      })
      .catch(() => {});
  }, []);

  const loadTokens = async () => {
    setTokensLoading(true);
    setTokensError('');
    try {
      const res = await fetch(`${API_BASE}/v1/tokens`, { credentials: 'include', headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch tokens');
      setTokens(data.tokens ?? []);
    } catch (e) {
      setTokensError(e instanceof Error ? e.message : 'Failed to fetch tokens');
    } finally {
      setTokensLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
  }, []);

  useEffect(() => {
    loadAiGatewayKeys();
  }, []);

  useEffect(() => {
    setGatewayInfoLoading(true);
    setGatewayInfoError('');
    fetch(`${API_BASE}/v1/ai/gateway`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : res.json().then((b) => Promise.reject(new Error(b.error || 'Failed to fetch gateway')))))
      .then((data) => {
        setGatewayInfo(data);
        if (Array.isArray(data?.otel) && data.otel.length > 0) {
          const urls = data.otel.map((entry: { url: string }) => entry.url).filter(Boolean);
          setOtelUrls(urls.length > 0 ? urls : [DEFAULT_OTEL_URL]);
        }
        setGatewayInfoLoading(false);
      })
      .catch((err) => {
        setGatewayInfoError(err instanceof Error ? err.message : 'Failed to fetch gateway');
        setGatewayInfoLoading(false);
      });
  }, []);

  const revokeAiGatewayKey = async (hash: string) => {
    if (!confirm('Revoke this AI key? It will stop working immediately.')) return;
    try {
      const res = await fetch(`${API_BASE}/v1/ai/keys/${encodeURIComponent(hash)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke key');
      await loadAiGatewayKeys();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revoke key');
    }
  };

  const deleteToken = async (tokenId: string) => {
    if (!confirm('Delete this API token?')) return;
    await fetch(`${API_BASE}/v1/tokens/${tokenId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: getAuthHeaders(),
    });
    await loadTokens();
  };

  const copyToken = (token?: string) => {
    if (!token) {
      alert('Full token not available. Refresh or re-login.');
      return;
    }
    navigator.clipboard.writeText(token);
  };

  const maskToken = (token?: string, preview?: string) => {
    if (!token) return preview || '—';
    if (token.length <= 8) return `${token.slice(0, 2)}…${token.slice(-2)}`;
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
  };

  const saveOtelDestinations = async () => {
    const urls = otelUrls.map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      setOtelMessage({ type: 'error', text: 'Add at least one OTEL URL.' });
      return;
    }
    setOtelSaving(true);
    setOtelMessage(null);
    try {
      const res = await fetch(`${API_BASE}/v1/ai/gateway/otel`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ otel_urls: urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update OTEL destinations');
      setOtelMessage({ type: 'success', text: 'OTEL destinations updated.' });
      setTimeout(() => setOtelMessage(null), 3000);
    } catch (e) {
      setOtelMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to update OTEL destinations' });
    } finally {
      setOtelSaving(false);
    }
  };

  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const saveProfileImage = async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await fetch(`${API_BASE}/v1/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ image: profileImageUrl.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      setMeUser((prev) => (prev ? { ...prev, image: profileImageUrl.trim() || null } : null));
      setProfileMessage({ type: 'success', text: 'Profile picture updated.' });
      setTimeout(() => setProfileMessage(null), 3000);
    } catch (e) {
      setProfileMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to update' });
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div>
      <h1 className="heading-1" style={{ marginBottom: '8px' }}>
        Settings
      </h1>
      <p className="text-large" style={{ marginBottom: '32px', color: '#555' }}>
        API tokens and profile settings.
      </p>

      <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as typeof settingsTab)}>
        <TabsList className="settings-tabs-list">
          <TabsTrigger value="user" className="settings-tabs-trigger">
            User settings
          </TabsTrigger>
          {meUser?.role === 'admin' && (
            <TabsTrigger value="gateway" className="settings-tabs-trigger">
              Gateway settings
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="user" className="settings-tabs-content">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
              gap: '24px',
            }}
          >
            {/* Profile picture URL */}
            <div className="card">
              <h2 className="heading-2" style={{ fontSize: '18px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={20} />
                Profile picture
              </h2>
              <p style={{ color: '#555', fontSize: '15px', marginBottom: '20px' }}>
                Set a profile picture by entering an image URL. It will appear in the sidebar and on events.
              </p>

              {meLoading ? (
                <p style={{ color: '#666' }}>Loading…</p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '24px', flexWrap: 'wrap', marginBottom: '20px' }}>
                    <div
                      style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        background: 'var(--bg-cream)',
                        border: '1px solid var(--border-default)',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {meUser?.image || profileImageUrl ? (
                        <img
                          src={meUser?.image || profileImageUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <User size={40} color="#888" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                        Image URL
                      </label>
                      <input
                        className="input"
                        type="url"
                        value={profileImageUrl}
                        onChange={(e) => setProfileImageUrl(e.target.value)}
                        placeholder="https://..."
                        disabled={profileSaving}
                        style={{ width: '100%', marginBottom: '12px' }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={saveProfileImage}
                        disabled={profileSaving}
                      >
                        {profileSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  {profileMessage && (
                    <div
                      style={{
                        padding: '12px',
                        background: profileMessage.type === 'success' ? 'var(--bg-mint)' : '#fee2e2',
                        border: `1px solid ${profileMessage.type === 'success' ? 'var(--border-default)' : '#dc2626'}`,
                        color: profileMessage.type === 'success' ? 'var(--dark)' : '#dc2626',
                        fontWeight: 600,
                      }}
                    >
                      {profileMessage.text}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* API tokens list */}
            <div className="card">
              <h2 className="heading-2" style={{ fontSize: '18px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key size={20} />
                API tokens
              </h2>
              <p style={{ color: '#555', fontSize: '15px', marginBottom: '20px' }}>
                Tokens are masked for safety. Delete any token you no longer need.
              </p>
              {tokensLoading ? (
                <p style={{ color: '#666' }}>Loading…</p>
              ) : tokensError ? (
                <div style={{ marginBottom: '16px', padding: '12px', background: '#fee2e2', border: '1px solid #dc2626', color: '#dc2626', fontWeight: 600 }}>
                  {tokensError}
                </div>
              ) : tokens.length === 0 ? (
                <p style={{ color: '#666' }}>No tokens yet.</p>
              ) : (
                <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                  <table style={{ width: '100%', minWidth: '360px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-mint)', borderBottom: 'var(--border-width) solid var(--border-color)' }}>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Name</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Token</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Team</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Created</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Last used</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.map((t) => (
                        <tr key={t.id} style={{ borderBottom: 'var(--border-width) solid var(--border-color)' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600 }}>{t.name}</td>
                          <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>{maskToken(t.token, t.token_preview)}</td>
                          <td style={{ padding: '12px 16px', color: '#555' }}>{t.team_id ? (teamNameById.get(t.team_id) || t.team_id) : '—'}</td>
                          <td style={{ padding: '12px 16px', color: '#555' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                          <td style={{ padding: '12px 16px', color: '#555' }}>{t.last_used ? new Date(t.last_used).toLocaleDateString() : '—'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button className="btn" onClick={() => copyToken(t.token)}>Copy</button>
                            <button className="btn" onClick={() => deleteToken(t.id)}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Inference keys (for you) - provisioned by managers - full width */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2 className="heading-2" style={{ fontSize: '18px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key size={20} />
                Inference keys (for you)
              </h2>
              <p style={{ color: '#555', fontSize: '15px', marginBottom: '20px' }}>
                Inference keys provisioned for you by a manager. Use in agents or the VS Code extension for LLM access.
              </p>
              {aiGatewayKeysLoading ? (
                <p style={{ color: '#666' }}>Loading…</p>
              ) : aiGatewayKeysError ? (
                <p style={{ color: '#dc2626', fontWeight: 600 }}>{aiGatewayKeysError}</p>
              ) : aiGatewayKeys.length === 0 ? (
                <p style={{ color: '#666' }}>No inference keys provisioned for you yet. Ask a manager to provision one from your user profile.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {aiGatewayKeys.map((k) => (
                    <div
                      key={k.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '16px 0',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '8px',
                          background: 'var(--bg-mint)',
                          border: '1px solid var(--border-default)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Key size={20} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link
                          to={`/keys/${k.key_hash}`}
                          style={{ fontSize: '16px', fontWeight: 600, textDecoration: 'none', color: 'inherit' }}
                        >
                          {k.name}
                        </Link>
                        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>
                          {k.key_hash.slice(0, 12)}…
                          {k.budget_usd ? ` · $${k.budget_usd} budget` : ''}
                          {k.spend_usd ? ` · $${k.spend_usd} spent` : ''}
                          {k.budget_reset ? ` · ${k.budget_reset}` : ''}
                        </p>
                      </div>
                      <span style={{ fontSize: '13px', color: '#666' }}>{new Date(k.created_at).toLocaleDateString()}</span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => revokeAiGatewayKey(k.key_hash)}
                        style={{ color: '#dc2626' }}
                      >
                        <Trash2 size={18} />
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {meUser?.role === 'admin' && <TabsContent value="gateway" className="settings-tabs-content">
          <div style={{ marginTop: '8px' }}>
            <h2 className="heading-2" style={{ fontSize: '20px', marginBottom: '12px' }}>
              Gateway settings
            </h2>

            <Tabs value={gatewayTab} onValueChange={(value) => setGatewayTab(value as typeof gatewayTab)}>
              <TabsList className="settings-subtabs-list">
                <TabsTrigger value="span-logs" className="settings-subtabs-trigger">
                  Span logs
                </TabsTrigger>
                <TabsTrigger value="ai-gateway" className="settings-subtabs-trigger">
                  AI gateway
                </TabsTrigger>
                <TabsTrigger value="billing" className="settings-subtabs-trigger">
                  Billing
                </TabsTrigger>
                <TabsTrigger value="destinations" className="settings-subtabs-trigger">
                  Destinations
                </TabsTrigger>
              </TabsList>

              <TabsContent value="span-logs" className="settings-tabs-content">
                <SpanLogs />
              </TabsContent>
              <TabsContent value="ai-gateway" className="settings-tabs-content">
                <AIGateway />
              </TabsContent>
              <TabsContent value="billing" className="settings-tabs-content">
                <Billing />
              </TabsContent>
              <TabsContent value="destinations" className="settings-tabs-content">
                <div>
                  <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 className="heading-2" style={{ fontSize: '18px', marginBottom: '8px' }}>
                      Destinations
                    </h3>
                    <p style={{ color: '#555', margin: 0 }}>
                      Add OpenTelemetry endpoints to receive gateway traces.
                    </p>
                  </div>

                  <div className="card" style={{ maxWidth: '720px' }}>
                    {gatewayInfoLoading ? (
                      <p style={{ color: '#666' }}>Loading gateway…</p>
                    ) : gatewayInfoError ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626' }}>
                        <AlertCircle size={16} />
                        {gatewayInfoError}
                      </div>
                    ) : !gatewayInfo?.cf_gateway_id ? (
                      <p style={{ color: '#666' }}>No gateway provisioned yet. Create one in the AI Gateway tab.</p>
                    ) : (
                      <>
                        <div style={{ marginBottom: '16px' }}>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>
                            Gateway ID
                          </label>
                          <div style={{ padding: '10px 14px', background: 'var(--bg-cream)', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}>
                            {gatewayInfo.cf_gateway_id}
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {otelUrls.map((url, idx) => (
                            <div key={`otel-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input
                                className="input"
                                type="url"
                                value={url}
                                onChange={(e) => {
                                  const next = [...otelUrls];
                                  next[idx] = e.target.value;
                                  setOtelUrls(next);
                                }}
                                placeholder="https://otel.example.com/v1/traces"
                                style={{ flex: 1, fontFamily: 'monospace' }}
                              />
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setOtelUrls((prev) => prev.filter((_, i) => i !== idx))}
                                disabled={otelUrls.length === 1}
                                title="Remove URL"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setOtelUrls((prev) => [...prev, ''])}
                          >
                            <Plus size={16} />
                            Add destination
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={saveOtelDestinations}
                            disabled={otelSaving}
                          >
                            {otelSaving ? 'Saving…' : 'Save destinations'}
                          </button>
                        </div>

                        {otelMessage && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', fontSize: '13px', color: otelMessage.type === 'success' ? '#16a34a' : '#dc2626' }}>
                            {otelMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                            {otelMessage.text}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>}
      </Tabs>
    </div>
  );
}
