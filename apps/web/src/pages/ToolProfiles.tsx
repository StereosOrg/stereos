import { useQuery } from '@tanstack/react-query';
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
      <div style={{ marginBottom: '40px' }}>
        <h1 className="heading-1">Tools</h1>
        <p className="text-large">
          Telemetry profiles from your connected tools and runtimes.
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
          <h3 style={{ fontWeight: 700, marginBottom: '8px' }}>No tools connected yet</h3>
          <p style={{ color: '#666' }}>
            Send OTLP telemetry to <code>POST /v1/traces</code> with a Bearer token to get started.
          </p>
        </div>
      ) : (
        <div className="grid-3">
          {profiles.map((profile) => (
            <Link
              key={profile.id}
              to={`/tools/${profile.id}`}
              className="card"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translate(-2px, -2px)';
                e.currentTarget.style.boxShadow = '6px 6px 0 var(--border-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translate(0, 0)';
                e.currentTarget.style.boxShadow = '4px 4px 0 var(--border-color)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <VendorIcon vendor={profile.vendor} displayName={profile.display_name} size={40} />
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800 }}>{profile.display_name}</div>
                  {profile.vendor_category && (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        background: 'var(--bg-mint)',
                        border: '2px solid var(--border-color)',
                        display: 'inline-block',
                      }}
                    >
                      {profile.vendor_category}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#555' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '20px', color: 'var(--dark)' }}>
                    {profile.total_spans.toLocaleString()}
                  </div>
                  <div>spans</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '20px', color: profile.total_errors > 0 ? '#c0392b' : 'var(--dark)' }}>
                    {profile.total_errors.toLocaleString()}
                  </div>
                  <div>errors</div>
                </div>
              </div>

              {profile.last_seen_at && (
                <div style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>
                  Last seen {new Date(profile.last_seen_at).toLocaleString()}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
