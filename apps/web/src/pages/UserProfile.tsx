import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { ToolIcon, toolDisplayName } from '../components/ToolIcon';
import { Key, Plus } from 'lucide-react';

interface UserProfile {
  profile: {
    user: {
      id: string;
      email: string;
      name: string | null;
      role: string;
      createdAt: string;
      image: string | null;
    };
    customer: {
      id: string;
      customer_id: string;
      billing_status: string;
    } | null;
  };
  usage: {
    stats: {
      total_events: string;
      active_days: string;
      first_activity: string | null;
      last_activity: string | null;
      favorite_tool: string | null;
    };
    monthly: Array<{
      month: string;
      event_count: string;
      agent_actions: string;
      outcomes: string;
      total_quantity: string;
      total_cost: string;
    }>;
    files: Array<{
      file_path: string;
      modification_count: string;
      last_modified: string;
    }>;
    diffs: Array<{
      id: string;
      vendor: string;
      start_time: string;
      diff: string;
    }>;
  };
  history: {
    recentEvents: Array<{
      id: string;
      actor_id: string;
      tool: string;
      intent: string;
      model: string | null;
      timestamp: string;
      files_written: string[] | null;
      artifacts: Array<{
        repo: string;
        branch: string | null;
        commit: string | null;
      }>;
      outcomes: Array<{
        status: string;
        linked_commit: string | null;
      }>;
    }>;
  };
}

export function UserProfile() {
  const { userId } = useParams<{ userId: string }>();
  const [error] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createKeyError, setCreateKeyError] = useState('');
  const [createdKeyRaw, setCreatedKeyRaw] = useState<string | null>(null);

  const { data: meData } = useQuery<{ user: { id: string; role?: string } }>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
  });

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['user-profile', userId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/v1/users/${userId}/profile`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Admin access required');
        }
        throw new Error('Failed to fetch profile');
      }
      return response.json();
    },
  });

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
        <p style={{ color: '#555' }}>Loading profile…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="card"
        style={{
          background: 'var(--bg-pink)',
          border: '1px solid #dc2626',
          padding: '24px',
        }}
      >
        <h2 className="heading-3" style={{ marginBottom: '8px', color: '#991b1b' }}>
          Error
        </h2>
        <p style={{ color: '#555' }}>{error}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px', color: '#555' }}>
        No profile data found
      </div>
    );
  }

  const { profile: userData, usage, history } = profile;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Link
          to="/users"
          className="btn"
          style={{
            display: 'inline-flex',
            marginBottom: '16px',
            textDecoration: 'none',
          }}
        >
          ← Back to users
        </Link>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: userData.user.image ? 'transparent' : 'var(--dark)',
              border: '2px solid var(--border-default)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 700,
              color: 'white',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {userData.user.image ? (
              <img
                src={userData.user.image}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              userData.user.name?.charAt(0) || userData.user.email.charAt(0).toUpperCase()
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="heading-1" style={{ marginBottom: '8px', fontSize: '32px' }}>
              {userData.user.name || 'Unnamed User'}
            </h1>
            <p className="text-large" style={{ color: '#555', marginBottom: '12px' }}>
              {userData.user.email}
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span
                className="badge"
                style={{
                  background: userData.user.role === 'admin' ? 'var(--dark)' : 'var(--bg-lavender)',
                  color: userData.user.role === 'admin' ? 'white' : 'var(--dark)',
                }}
              >
                {userData.user.role}
              </span>
              {userData.customer && (
                <span
                  className="badge"
                  style={{
                    background:
                      userData.customer.billing_status === 'active'
                        ? 'var(--accent-green)'
                        : userData.customer.billing_status === 'past_due'
                          ? 'var(--accent-yellow)'
                          : 'var(--bg-pink)',
                    color: 'var(--dark)',
                  }}
                >
                  {userData.customer.billing_status}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Provision OpenRouter key (managers viewing another user) */}
      {meData?.user && userId && userId !== meData.user.id && (meData.user.role === 'admin' || meData.user.role === 'manager') && userData.customer && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h2 className="heading-3" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={20} />
            Provision OpenRouter key
          </h2>
          <p style={{ color: '#555', fontSize: '15px', marginBottom: '16px' }}>
            Create an OpenRouter key for this user. They will see it in Settings.
          </p>
          {createdKeyRaw && (
            <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', borderRadius: '8px' }}>
              <p style={{ fontWeight: 600, marginBottom: '8px' }}>Key created — copy and share it with the user. It won't be shown again.</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '13px' }}>{createdKeyRaw}</code>
                <button type="button" className="btn" onClick={() => { navigator.clipboard.writeText(createdKeyRaw); }}>Copy</button>
                <button type="button" className="btn" onClick={() => setCreatedKeyRaw(null)}>Dismiss</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input"
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="Key name (e.g. Cursor, CLI)"
              disabled={creatingKey}
              style={{ flex: '1 1 200px', minWidth: '180px' }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={creatingKey || !keyName.trim()}
              onClick={async () => {
                if (!keyName.trim() || !userData.customer) return;
                setCreatingKey(true);
                setCreateKeyError('');
                setCreatedKeyRaw(null);
                try {
                  const res = await fetch(`${API_BASE}/v1/keys/user`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    credentials: 'include',
                    body: JSON.stringify({
                      name: keyName.trim(),
                      customer_id: userData.customer.id,
                      user_id: userId,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Failed to create key');
                  setCreatedKeyRaw(data.key ?? null);
                  setKeyName('');
                } catch (e) {
                  setCreateKeyError(e instanceof Error ? e.message : 'Failed to create key');
                } finally {
                  setCreatingKey(false);
                }
              }}
            >
              <Plus size={18} />
              {creatingKey ? 'Creating…' : 'Create key'}
            </button>
          </div>
          {createKeyError && <p style={{ color: '#dc2626', fontWeight: 600, marginTop: '12px' }}>{createKeyError}</p>}
        </div>
      )}

      {/* Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        <StatCard
          label="Total events"
          value={parseInt(usage.stats.total_events || '0').toLocaleString()}
          variant="white"
        />
        <StatCard
          label="Active days"
          value={parseInt(usage.stats.active_days || '0').toLocaleString()}
          variant="white"
        />
        <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-white)' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--dark)', opacity: 0.8, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Favorite tool</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ToolIcon tool={usage.stats.favorite_tool ?? undefined} size={28} />
            <span style={{ fontWeight: 600, color: 'var(--dark)', fontSize: '1rem' }}>
              {toolDisplayName(usage.stats.favorite_tool)}
            </span>
          </div>
        </div>
        <StatCard
          label="Member since"
          value={new Date(userData.user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' })}
          variant="white"
        />
      </div>

      {/* Two Column Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '24px',
        }}
      >
        {/* Recent Events */}
        <div className="card">
          <h2 className="heading-3" style={{ marginBottom: '16px' }}>
            Recent events
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {history.recentEvents.length === 0 ? (
              <p style={{ color: '#555', textAlign: 'center', padding: '24px' }}>
                No events yet
              </p>
            ) : (
              history.recentEvents.slice(0, 8).map((event) => (
                <div
                  key={event.id}
                  style={{
                    padding: '12px 16px',
                    background: 'var(--bg-mint)',
                    border: '1px solid var(--border-default)',
                    borderLeft: '3px solid var(--accent-blue)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '6px',
                        background: 'var(--bg-white)',
                        border: '1px solid var(--border-default)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--dark)',
                        flexShrink: 0,
                      }}
                    >
                      <ToolIcon actorId={event.actor_id} tool={event.tool} size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, margin: 0, fontSize: '15px' }}>
                        {event.intent}
                      </p>
                      <p style={{ fontSize: '13px', color: '#555', margin: '4px 0 0' }}>
                        {event.tool} · {event.actor_id}
                      </p>
                      <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                      {event.outcomes?.length > 0 && (
                        <span
                          className="badge"
                          style={{
                            marginTop: '8px',
                            display: 'inline-block',
                            fontSize: '11px',
                            background:
                              event.outcomes[0].status === 'accepted'
                                ? 'var(--accent-green)'
                                : event.outcomes[0].status === 'rejected'
                                  ? 'var(--bg-pink)'
                                  : 'var(--bg-lavender)',
                            color: 'var(--dark)',
                          }}
                        >
                          {event.outcomes[0].status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column: API Keys (includes OpenRouter monthly usage) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* API Keys (user + team scoped, with OpenRouter usage) */}
          {userId && (
            <UserKeysSection userId={userId} />
          )}
        </div>
      </div>
    </div>
  );
}

interface AiKeyItem {
  id: string;
  key_hash: string;
  name: string;
  user_id: string | null;
  team_id: string | null;
  team: { id: string; name: string } | null;
  budget_usd: string | null;
  spend_usd: string;
  budget_reset: string | null;
  disabled: boolean;
  created_at: string;
}

function UserKeysSection({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery<{ keys: AiKeyItem[] }>({
    queryKey: ['user-keys', userId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/keys/user/${userId}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch keys');
      return res.json();
    },
    enabled: !!userId,
  });

  const keys = data?.keys ?? [];
  const hasKeys = keys.length > 0;
  const totalSpend = keys.reduce((sum, k) => sum + parseFloat(String(k.spend_usd ?? '0')), 0);

  if (isLoading) {
    return (
      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>AI keys</h2>
        <p style={{ color: '#555' }}>Loading keys…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>AI keys</h2>
        <p style={{ color: '#dc2626', fontWeight: 600 }}>Failed to load keys.</p>
      </div>
    );
  }

  const KeyRow = ({ k }: { k: AiKeyItem }) => (
    <Link
      to={`/keys/${k.key_hash}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        background: 'var(--bg-white)',
        border: '1px solid var(--border-default)',
        borderRadius: '6px',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Key size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{k.name}</p>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#555' }}>
          {k.key_hash.slice(0, 12)}…
          {k.budget_usd ? ` · $${parseFloat(k.budget_usd).toFixed(2)} budget` : ''}
          {k.budget_reset ? ` · ${k.budget_reset}` : ''}
          {k.team ? ` · ${k.team.name}` : ' · User'}
          {` · $${parseFloat(String(k.spend_usd ?? '0')).toFixed(2)} spent`}
        </p>
      </div>
      <span style={{ fontSize: '12px', color: '#666' }}>{new Date(k.created_at).toLocaleDateString()}</span>
    </Link>
  );

  return (
    <div className="card">
      <h2 className="heading-3" style={{ marginBottom: '16px' }}>AI keys</h2>
      {hasKeys && totalSpend > 0 && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', borderRadius: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total spend</span>
          <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 700 }}>${totalSpend.toFixed(2)}</p>
        </div>
      )}
      {!hasKeys ? (
        <p style={{ color: '#555', textAlign: 'center', padding: '24px' }}>No AI keys for this user yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {keys.map((k) => <KeyRow key={k.id} k={k} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: 'mint' | 'lavender' | 'cream' | 'pink' | 'white';
}) {
  const bg =
    variant === 'white'
      ? 'var(--bg-white)'
      : variant === 'mint'
        ? 'var(--bg-mint)'
        : variant === 'lavender'
          ? 'var(--bg-lavender)'
          : variant === 'cream'
            ? 'var(--bg-cream)'
            : 'var(--bg-pink)';
  return (
    <div
      className="card"
      style={{
        background: bg,
        padding: '20px',
      }}
    >
      <p style={{ fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </p>
      <p style={{ fontSize: '20px', fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </p>
    </div>
  );
}
