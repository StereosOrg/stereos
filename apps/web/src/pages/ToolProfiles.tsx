import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon } from '../components/ToolIcon';

interface ToolProfile {
  id: string;
  vendor: string;
  display_name: string;
  vendor_category: string | null;
  total_spans: number;
  total_traces: number;
  total_errors: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export function ToolProfiles() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ profiles: ToolProfile[] }>({
    queryKey: ['tool-profiles'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/tool-profiles`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch tool profiles');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '4px solid var(--border-color)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
      </div>
    );
  }

  const profiles = data?.profiles || [];

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 className="heading-1" style={{ margin: 0 }}>
          Global Sources
        </h1>
        <p className="text-large" style={{ color: '#555', margin: '8px 0 0' }}>
          {profiles.length} total global sources
        </p>
      </div>

      {profiles.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '60px 24px',
          }}
        >
          <Wrench size={48} style={{ color: '#999', marginBottom: '16px' }} />
          <h3 style={{ fontWeight: 700, marginBottom: '8px' }}>No sources connected yet</h3>
          <p style={{ color: '#666' }}>
            Send OTLP telemetry to <code>POST /v1/traces</code> with a Bearer token to get started.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  background: 'var(--bg-mint)',
                  borderBottom: 'var(--border-width) solid var(--border-color)',
                }}
              >
                <th
                  style={{
                    padding: '16px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--dark)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Source
                </th>
                <th
                  style={{
                    padding: '16px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--dark)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Category
                </th>
                <th
                  style={{
                    padding: '16px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--dark)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Spans
                </th>
                <th
                  style={{
                    padding: '16px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--dark)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Errors
                </th>
                <th
                  style={{
                    padding: '16px 24px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--dark)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Last Seen
                </th>
                <th
                  style={{
                    padding: '16px 24px',
                    textAlign: 'right',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--dark)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr
                  key={profile.id}
                  style={{
                    borderBottom: 'var(--border-width) solid var(--border-color)',
                    background: 'var(--bg-white)',
                  }}
                >
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <VendorIcon vendor={profile.vendor} displayName={profile.display_name} size={40} />
                      <div>
                        <p style={{ fontWeight: 600, margin: 0 }}>{profile.display_name}</p>
                        <p style={{ fontSize: '13px', color: '#555', margin: '2px 0 0' }}>{profile.vendor}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {profile.vendor_category ? (
                      <span
                        className="badge"
                        style={{
                          background: 'var(--bg-mint)',
                          color: 'var(--dark)',
                        }}
                      >
                        {profile.vendor_category}
                      </span>
                    ) : (
                      <span style={{ color: '#888' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px', fontWeight: 600 }}>{profile.total_spans.toLocaleString()}</td>
                  <td
                    style={{
                      padding: '16px 24px',
                      fontWeight: 600,
                      color: profile.total_errors > 0 ? '#c0392b' : 'var(--dark)',
                    }}
                  >
                    {profile.total_errors.toLocaleString()}
                  </td>
                  <td style={{ padding: '16px 24px', color: '#555' }}>
                    {profile.last_seen_at
                      ? new Date(profile.last_seen_at).toLocaleString()
                      : '—'}
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <Link
                      to={`/ingest/${profile.id}`}
                      className="btn btn-primary"
                      style={{ padding: '8px 16px', fontSize: '14px', textDecoration: 'none' }}
                    >
                      View
                    </Link>
                    <button
                      className="btn"
                      onClick={async () => {
                        if (!confirm('Delete this source and all associated spans/metrics?')) return;
                        await fetch(`${API_BASE}/v1/tool-profiles/${profile.id}`, {
                          method: 'DELETE',
                          credentials: 'include',
                          headers: getAuthHeaders(),
                        });
                        queryClient.invalidateQueries({ queryKey: ['tool-profiles'] });
                      }}
                      style={{ padding: '8px 16px', fontSize: '14px' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
