import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon } from '../components/ToolIcon';

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

export function TeamProfile() {
  const { teamId } = useParams<{ teamId: string }>();
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

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '3px solid var(--border-color)',
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
      <div className="card" style={{ padding: '24px', background: 'var(--bg-pink)', border: '3px solid #dc2626' }}>
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
              border: '3px solid var(--border-color)',
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
                <div key={d.id} style={{ padding: '10px 12px', background: 'var(--bg-mint)', border: '2px solid var(--border-color)' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.diff.split('\\n')[0] || 'diff'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                    {d.vendor} · {new Date(d.start_time).toLocaleString()}
                  </div>
                  <Link to={`/diffs/${d.id}`} style={{ fontSize: '12px' }}>View diff</Link>
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
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: 'var(--bg-mint)', border: '2px solid var(--border-color)' }}>
                <VendorIcon vendor={s.vendor} displayName={s.vendor} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{s.intent}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{s.vendor}{s.model ? ` · ${s.model}` : ''}</div>
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>{new Date(s.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
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
