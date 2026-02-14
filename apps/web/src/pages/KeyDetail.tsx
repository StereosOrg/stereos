import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Key, DollarSign, Calendar, Zap } from 'lucide-react';

interface KeyDetailData {
  key: {
    hash: string;
    name: string;
    label: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    created_at: string;
    updated_at: string | null;
    expires_at: string | null;
    user_id: string | null;
    team_id: string | null;
  };
}

export function KeyDetail() {
  const { hash } = useParams<{ hash: string }>();

  const { data, isLoading, error } = useQuery<KeyDetailData>({
    queryKey: ['key-detail', hash],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/keys/${hash}/details`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error('Key not found');
        if (res.status === 403) throw new Error('Access denied');
        throw new Error('Failed to load key details');
      }
      return res.json();
    },
    enabled: !!hash,
  });

  if (!hash) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <p style={{ color: '#555' }}>Invalid key</p>
        <Link to="/keys" className="btn" style={{ marginTop: '16px', display: 'inline-block' }}>
          Back to keys
        </Link>
      </div>
    );
  }

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
        <p style={{ color: '#555' }}>Loading key…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontWeight: 600 }}>{error instanceof Error ? error.message : 'Failed to load key'}</p>
        <Link to="/keys" className="btn" style={{ marginTop: '16px', display: 'inline-block' }}>
          Back to keys
        </Link>
      </div>
    );
  }

  const k = data.key;
  const scopeLabel = k.team_id ? 'Team' : k.user_id ? 'User' : '—';
  const expiresLabel = k.expires_at
    ? new Date(k.expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : 'No expiry';

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Link to="/keys" className="btn" style={{ textDecoration: 'none' }}>
          ← Back to keys
        </Link>
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Key size={32} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="heading-1" style={{ margin: 0 }}>{k.name}</h1>
            {k.label && k.label !== k.name && (
              <p style={{ fontSize: '14px', color: '#555', margin: '4px 0 0' }}>{k.label}</p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
              <span
                className="badge"
                style={{
                  background: k.disabled ? 'var(--bg-pink)' : 'var(--accent-green)',
                  color: k.disabled ? '#991b1b' : 'var(--dark)',
                }}
              >
                {k.disabled ? 'Disabled' : 'Active'}
              </span>
              <span style={{ fontSize: '14px', color: '#555' }}>{scopeLabel} key</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: '24px' }}>
        <StatCard
          label="Total usage"
          value={`$${k.usage.toFixed(2)}`}
          icon={DollarSign}
        />
        <StatCard
          label="Limit remaining"
          value={k.limit_remaining != null ? `$${k.limit_remaining.toFixed(2)}` : '—'}
          icon={Zap}
        />
        <StatCard
          label="Expires"
          value={expiresLabel}
          icon={Calendar}
        />
      </div>

      <div className="grid-3" style={{ marginBottom: '24px' }}>
        <StatCard label="Usage (monthly)" value={`$${k.usage_monthly.toFixed(2)}`} />
        <StatCard label="Usage (weekly)" value={`$${k.usage_weekly.toFixed(2)}`} />
        <StatCard label="Usage (daily)" value={`$${k.usage_daily.toFixed(2)}`} />
      </div>

      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>Key details</h2>
        <div style={{ display: 'grid', gap: '16px' }}>
          <DetailRow label="Hash" value={k.hash} monospace />
          <DetailRow label="Limit" value={k.limit != null ? `$${k.limit.toFixed(2)}` : '—'} />
          <DetailRow label="Limit reset" value={k.limit_reset ?? '—'} />
          <DetailRow label="Scope" value={scopeLabel} />
          <DetailRow label="Created" value={new Date(k.created_at).toLocaleString()} />
          <DetailRow label="Updated" value={k.updated_at ? new Date(k.updated_at).toLocaleString() : '—'} />
          <DetailRow label="Expires" value={k.expires_at ? new Date(k.expires_at).toLocaleString() : 'No expiry'} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Key;
}) {
  return (
    <div className="card" style={{ padding: '16px' }}>
      {Icon && (
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
            marginBottom: '12px',
          }}
        >
          <Icon size={20} />
        </div>
      )}
      <div style={{ fontSize: '12px', color: '#555', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function DetailRow({ label, value, monospace }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px', padding: '12px 0', borderBottom: '1px solid var(--border-default)' }}>
      <span style={{ fontSize: '14px', color: '#555', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: 600, wordBreak: 'break-all', fontFamily: monospace ? 'monospace' : undefined }}>{value}</span>
    </div>
  );
}
