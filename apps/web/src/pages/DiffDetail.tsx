import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { DiffViewer } from '../components/DiffViewer';

export function DiffDetail() {
  const { spanId } = useParams<{ spanId: string }>();

  const { data, isLoading, error } = useQuery<{ span: { id: string; vendor: string; span_name: string; start_time: string; span_attributes: Record<string, string> | null } }>(
    {
      queryKey: ['span', spanId],
      queryFn: async () => {
        const res = await fetch(`${API_BASE}/v1/spans/${spanId}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error('Failed to fetch span');
        return res.json();
      },
      enabled: !!spanId,
    }
  );

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
        <p style={{ color: '#555' }}>Loading diff…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data?.span) {
    return (
      <div className="card" style={{ padding: '24px', background: 'var(--bg-pink)', border: '3px solid #dc2626' }}>
        <h2 className="heading-3" style={{ marginBottom: '8px', color: '#991b1b' }}>Error</h2>
        <p style={{ color: '#555' }}>Unable to load diff.</p>
      </div>
    );
  }

  const diff = data.span.span_attributes?.['tool.output.diff'] ?? '';

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <Link to="/users" className="btn" style={{ textDecoration: 'none' }}>← Back to users</Link>
      </div>
      <div className="card" style={{ marginBottom: '16px', padding: '16px 20px' }}>
        <div style={{ fontWeight: 700, marginBottom: '6px' }}>{data.span.span_name}</div>
        <div style={{ color: '#555', fontSize: '14px' }}>
          {data.span.vendor} · {new Date(data.span.start_time).toLocaleString()}
        </div>
      </div>
      <DiffViewer diff={diff} />
    </div>
  );
}
