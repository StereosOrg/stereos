import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE } from '../lib/api';
import { ToolIcon, toolDisplayName } from '../components/ToolIcon';

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
      partner: {
        name: string;
        partner_id: string;
      };
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
            border: '3px solid var(--border-color)',
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
          border: '3px solid #dc2626',
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
              borderRadius: '12px',
              background: 'var(--dark)',
              border: '3px solid var(--border-color)',
              boxShadow: '4px 4px 0 var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 700,
              color: 'white',
            }}
          >
            {userData.user.name?.charAt(0) || userData.user.email.charAt(0).toUpperCase()}
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
          variant="mint"
        />
        <StatCard
          label="Active days"
          value={parseInt(usage.stats.active_days || '0').toLocaleString()}
          variant="lavender"
        />
        <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-cream)', border: '2px solid var(--border-color)' }}>
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
          variant="pink"
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
                    border: '2px solid var(--border-color)',
                    borderLeft: '4px solid var(--dark)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '6px',
                        background: 'var(--bg-white)',
                        border: '2px solid var(--border-color)',
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

        {/* Right column: Monthly Usage + File Activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Monthly Usage */}
          {usage.monthly.length > 0 && (
            <div className="card">
              <h2 className="heading-3" style={{ marginBottom: '16px' }}>
                Monthly usage
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {usage.monthly.map((month, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px 16px',
                      background: 'var(--bg-cream)',
                      border: '2px solid var(--border-color)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600 }}>
                        {new Date(month.month).toLocaleDateString('en-US', {
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        ${parseFloat(month.total_cost || '0').toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '13px' }}>
                      <span className="badge">{parseInt(month.agent_actions || '0')} actions</span>
                      <span className="badge">{parseInt(month.outcomes || '0')} outcomes</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Activity */}
          <div className="card">
            <h2 className="heading-3" style={{ marginBottom: '16px' }}>
              Most modified files
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {usage.files.length === 0 ? (
                <p style={{ color: '#555', textAlign: 'center', padding: '24px' }}>
                  No file activity yet
                </p>
              ) : (
                usage.files.map((file, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      background: 'var(--bg-mint)',
                      border: '2px solid var(--border-color)',
                    }}
                  >
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '4px',
                        background: 'var(--dark)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: '13px',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          margin: 0,
                        }}
                        title={file.file_path}
                      >
                        {file.file_path}
                      </p>
                    </div>
                    <span className="badge" style={{ flexShrink: 0 }}>
                      {file.modification_count} edits
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
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
  variant: 'mint' | 'lavender' | 'cream' | 'pink';
}) {
  const bg =
    variant === 'mint'
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
