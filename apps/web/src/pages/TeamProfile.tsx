import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon } from '../components/ToolIcon';
import { Key, Plus, Trash2 } from 'lucide-react';

interface TeamProfileResponse {
  team: {
    id: string;
    name: string;
    profile_pic: string | null;
  };
  stats: {
    total_spans: number;
    total_traces: number;
    total_errors: number;
    active_members: number;
    error_rate: number;
    traces_per_member: number;
    first_activity: string | null;
    last_activity: string | null;
  };
  top_vendors: Array<{ vendor: string; span_count: number }>;
  recent_diffs: Array<{ id: string; vendor: string; start_time: string; diff: string }>;
  recent_spans: Array<{
    id: string;
    intent: string;
    vendor: string;
    model: string | null;
    timestamp: string;
  }>;
}

interface AiGatewayKey {
  id: string;
  key_hash: string;
  name: string;
  budget_usd: string | null;
  spend_usd: string;
  budget_reset: string | null;
  allowed_models: string[] | null;
  disabled: boolean;
  user: { id: string; name: string | null; email: string | null } | null;
  created_at: string;
}

export function TeamProfile() {
  const { teamId } = useParams<{ teamId: string }>();
  const [keyName, setKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createKeyError, setCreateKeyError] = useState('');
  const [createdKeyRaw, setCreatedKeyRaw] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<TeamProfileResponse>({
    queryKey: ['team-profile', teamId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/teams/${teamId}/profile`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch team profile');
      return res.json();
    },
    enabled: !!teamId,
  });

  const { data: meData } = useQuery<{ user: { id: string; role?: string } }>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
  });

  const { data: customerData } = useQuery<{ customer: { id: string } }>({
    queryKey: ['customers-me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/customers/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch customer');
      return res.json();
    },
  });

  const customerId = customerData?.customer?.id;

  const {
    data: teamKeysData,
    isLoading: teamKeysLoading,
    refetch: refetchTeamKeys,
  } = useQuery<{ keys: AiGatewayKey[] }>({
    queryKey: ['team-keys', teamId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/keys/team/${teamId}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error('Failed to fetch team keys');
      return res.json();
    },
    enabled: !!teamId,
    retry: false,
  });

  const isTeamMember = !teamKeysData && teamKeysLoading ? null : teamKeysData != null;
  const isManagerOrAdmin = meData?.user?.role === 'admin' || meData?.user?.role === 'manager';

  const createTeamKey = async () => {
    if (!teamId || !keyName.trim() || !customerId) return;
    setCreatingKey(true);
    setCreateKeyError('');
    setCreatedKeyRaw(null);
    try {
      const res = await fetch(`${API_BASE}/v1/ai/keys/team/${teamId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ name: keyName.trim(), customer_id: customerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');
      setCreatedKeyRaw(data.key ?? null);
      setKeyName('');
      refetchTeamKeys();
    } catch (e) {
      setCreateKeyError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeTeamKey = async (hash: string) => {
    if (!confirm('Revoke this AI key? It will stop working immediately.')) return;
    try {
      const res = await fetch(`${API_BASE}/v1/ai/keys/${encodeURIComponent(hash)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke key');
      refetchTeamKeys();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revoke key');
    }
  };

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '1px solid var(--border-default)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ color: '#555' }}>Loading team…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: '24px', background: 'var(--bg-pink)', border: '1px solid #dc2626' }}>
        <h2 className="heading-3" style={{ marginBottom: '8px', color: '#991b1b' }}>Error</h2>
        <p style={{ color: '#555' }}>Unable to load team profile.</p>
      </div>
    );
  }

  const { team, stats, recent_spans } = data;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Link to="/users" className="btn" style={{ textDecoration: 'none' }}>← Back to users</Link>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '12px',
              background: 'var(--bg-cream)',
              border: '1px solid var(--border-default)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {team.profile_pic ? (
              <img src={team.profile_pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontWeight: 800, fontSize: '24px' }}>{team.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div>
            <h1 className="heading-1" style={{ margin: 0 }}>{team.name}</h1>
            <p style={{ color: '#555', margin: '6px 0 0' }}>Team overview</p>
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: '24px' }}>
        <StatCard label="Total spans" value={stats.total_spans} />
        <StatCard label="Total traces" value={stats.total_traces} />
        <StatCard label="Active members (30d)" value={stats.active_members} />
      </div>

      <div className="grid-3" style={{ marginBottom: '24px' }}>
        <StatCard label="Errors" value={stats.total_errors} />
        <StatCard label="Error rate" value={`${Math.round(stats.error_rate * 100)}%`} />
        <StatCard label="Traces/member (30d)" value={stats.traces_per_member.toFixed(1)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', marginBottom: '24px' }}>
        <div className="card">
          <h2 className="heading-3" style={{ marginBottom: '16px' }}>Top vendors (30d)</h2>
          {data.top_vendors.length === 0 ? (
            <p style={{ color: '#555' }}>No vendor data.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.top_vendors.map((v) => (
                <div key={v.vendor} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <VendorIcon vendor={v.vendor} displayName={v.vendor} size={28} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{v.vendor}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>{v.span_count} spans</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="heading-3" style={{ marginBottom: '16px' }}>Recent diffs</h2>
          {data.recent_diffs.length === 0 ? (
            <p style={{ color: '#555' }}>No diffs yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.recent_diffs.map((d) => (
                <div key={d.id} style={{ padding: '10px 12px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.diff.split('\\n')[0] || 'diff'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                    {d.vendor} · {new Date(d.start_time).toLocaleString()}
                  </div>
                  <Link to={`/spans/${d.id}`} style={{ fontSize: '12px' }}>View span</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>Recent spans</h2>
        {recent_spans.length === 0 ? (
          <p style={{ color: '#555' }}>No spans yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recent_spans.map((s) => (
              <Link key={s.id} to={`/spans/${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', textDecoration: 'none', color: 'inherit' }}>
                <VendorIcon vendor={s.vendor} displayName={s.vendor} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{s.intent}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{s.vendor}{s.model ? ` · ${s.model}` : ''}</div>
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>{new Date(s.timestamp).toLocaleString()}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {isTeamMember && (
        <div className="card" style={{ marginTop: '24px' }}>
          <h2 className="heading-3" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={20} />
            Team AI Gateway keys
          </h2>
          <p style={{ color: '#555', fontSize: '15px', marginBottom: '16px' }}>
            AI Gateway keys for this team. Use in agents or the VS Code extension for LLM access.
          </p>
          {createdKeyRaw && (
            <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', borderRadius: '8px' }}>
              <p style={{ fontWeight: 600, marginBottom: '8px' }}>Key created — copy it now. You won't see it again.</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '13px' }}>{createdKeyRaw}</code>
                <button type="button" className="btn" onClick={() => { navigator.clipboard.writeText(createdKeyRaw); }}>Copy</button>
                <button type="button" className="btn" onClick={() => setCreatedKeyRaw(null)}>Dismiss</button>
              </div>
            </div>
          )}
          {isManagerOrAdmin && (
            <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Key name (e.g. Production)"
                disabled={creatingKey}
                style={{ flex: '1 1 200px', minWidth: '180px' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={createTeamKey}
                disabled={creatingKey || !keyName.trim() || !customerId}
              >
                <Plus size={18} />
                {creatingKey ? 'Creating…' : 'Create key'}
              </button>
            </div>
          )}
          {createKeyError && <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: '12px' }}>{createKeyError}</p>}
          {teamKeysLoading ? (
            <p style={{ color: '#666' }}>Loading keys…</p>
          ) : !teamKeysData?.keys?.length ? (
            <p style={{ color: '#666' }}>No team keys yet.{isManagerOrAdmin ? ' Create one above.' : ''}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {teamKeysData.keys.map((k) => (
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
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Key size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{k.name}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>
                      {k.key_hash.slice(0, 12)}…
                      {k.budget_usd ? ` · $${k.budget_usd} budget` : ''}
                      {k.spend_usd ? ` · $${k.spend_usd} spent` : ''}
                      {k.budget_reset ? ` · ${k.budget_reset}` : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: '13px', color: '#666' }}>{new Date(k.created_at).toLocaleDateString()}</span>
                  {isManagerOrAdmin && (
                    <button type="button" className="btn" onClick={() => revokeTeamKey(k.key_hash)} style={{ color: '#dc2626' }}>
                      <Trash2 size={18} /> Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card" style={{ padding: '16px' }}>
      <div style={{ fontSize: '12px', color: '#555', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 800 }}>{value.toLocaleString()}</div>
    </div>
  );
}
