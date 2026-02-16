import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Key, DollarSign, Calendar, Zap } from 'lucide-react';

interface KeyDetailData {
  id: string;
  key_hash: string;
  name: string;
  disabled: boolean;
  budget_usd: string | null;
  spend_usd: string;
  budget_remaining: number | null;
  budget_reset: string | null;
  allowed_models: string[] | null;
  created_at: string;
  spend_reset_at: string | null;
  user: { id: string; name: string | null; email: string } | null;
  team: { id: string; name: string } | null;
}

export function KeyDetail() {
  const { hash } = useParams<{ hash: string }>();

  const { data, isLoading, error } = useQuery<KeyDetailData>({
    queryKey: ['key-detail', hash],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/keys/${hash}/details`, {
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

  const k = data;
  const fmtUsd = (v: number) => {
    if (v === 0) return '$0.00';
    if (v < 0.01) return `$${v.toPrecision(2)}`;
    return `$${v.toFixed(2)}`;
  };

  const scopeLabel = k.team ? 'Team' : k.user ? 'User' : '—';

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
          label="Total spend"
          value={fmtUsd(parseFloat(String(k.spend_usd ?? '0')))}
          icon={DollarSign}
        />
        <StatCard
          label="Budget remaining"
          value={k.budget_remaining != null ? fmtUsd(k.budget_remaining) : '—'}
          icon={Zap}
        />
        <StatCard
          label="Budget"
          value={k.budget_usd != null ? fmtUsd(parseFloat(String(k.budget_usd))) : 'Unlimited'}
          icon={Calendar}
        />
      </div>

      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>Key details</h2>
        <div style={{ display: 'grid', gap: '16px' }}>
          <DetailRow label="Key hash" value={k.key_hash} monospace />
          <DetailRow label="Budget" value={k.budget_usd != null ? `$${parseFloat(String(k.budget_usd)).toFixed(2)}` : '—'} />
          <DetailRow label="Budget remaining" value={k.budget_remaining != null ? `$${k.budget_remaining.toFixed(2)}` : '—'} />
          <DetailRow label="Budget reset" value={k.budget_reset ?? '—'} />
          <DetailRow label="Allowed models" value={k.allowed_models?.join(', ') ?? 'All models'} />
          <DetailRow label="Scope" value={scopeLabel} />
          <DetailRow label="Created" value={new Date(k.created_at).toLocaleString()} />
          <DetailRow label="Spend resets" value={k.spend_reset_at ? new Date(k.spend_reset_at).toLocaleString() : '—'} />
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
