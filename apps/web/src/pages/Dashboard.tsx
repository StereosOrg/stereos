import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, GitCommit, Users, Zap, Terminal } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { ToolIcon } from '../components/ToolIcon';

interface DashboardEvent {
  id: string;
  intent: string;
  actor_id: string;
  tool: string;
  model?: string;
  timestamp: string;
  user?: { id: string; name: string | null; image: string | null; email: string } | null;
}

interface DashboardStats {
  total_events: number;
  total_commits: number;
  active_agents: number;
  recent_events: DashboardEvent[];
}

export function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/v1/dashboard`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch dashboard');
      return response.json();
    },
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

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <h1 className="heading-1">Dashboard</h1>
        <p className="text-large">
          Track your team's provenance events and code lineage.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid-3" style={{ marginBottom: '40px' }}>
        <StatCard
          title="Total Events"
          value={stats?.total_events || 0}
          icon={Activity}
          color="var(--bg-lavender)"
          description="Provenance events tracked"
        />
        <StatCard
          title="Linked Commits"
          value={stats?.total_commits || 0}
          icon={GitCommit}
          color="var(--bg-cream)"
          description="Commits with provenance data"
        />
        <StatCard
          title="Active Agents"
          value={stats?.active_agents ?? 0}
          icon={Zap}
          color="var(--bg-pink)"
          description="Distinct agent sources"
        />
      </div>

      {/* Main Content Area */}
      <div className="grid-2">
        {/* Recent Events */}
        <div className="card card-mint" style={{ minHeight: '400px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                background: 'var(--dark)',
                border: '3px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Activity size={20} color="white" />
            </div>
            <h2 className="heading-3">Recent Events</h2>
          </div>
          
          {!stats?.recent_events?.length ? (
            <div
              style={{
                background: 'var(--bg-white)',
                border: '3px solid var(--border-color)',
                padding: '32px',
                textAlign: 'center',
              }}
            >
              <p style={{ color: '#666', marginBottom: '16px' }}>
                No events yet. Start ingesting!
              </p>
              <Link to="/events" className="btn btn-primary" style={{ display: 'inline-flex' }}>
                Search Events
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stats.recent_events.map((event) => (
                <Link
                  key={event.id}
                  to={`/events/${event.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 20px',
                    borderBottom: '2px solid var(--border-color)',
                    background: 'var(--bg-white)',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-mint)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-white)';
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      background: 'var(--dark)',
                      border: '2px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    {event.user?.image ? (
                      <img
                        src={event.user.image}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ fontSize: '16px', fontWeight: 700, color: 'white' }}>
                        {event.user?.name?.charAt(0) || event.user?.email?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '8px',
                      background: 'var(--bg-mint)',
                      border: '2px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <ToolIcon actorId={event.actor_id} tool={event.tool} size={24} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, lineHeight: 1.3 }}>
                      {event.intent}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>
                      {event.actor_id} · {event.tool}
                      {event.model ? ` · ${event.model}` : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: '13px', color: '#666', flexShrink: 0 }}>
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div>
          <div className="card card-lavender" style={{ marginBottom: '24px' }}>
            <h2 className="heading-3">Quick Actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Link to="/events" className="btn" style={{ justifyContent: 'flex-start' }}>
                <Activity size={18} />
                Search Events
              </Link>
              <Link to="/settings" className="btn" style={{ justifyContent: 'flex-start' }}>
                <Users size={18} />
                API & Team
              </Link>
            </div>
          </div>

          <div className="card card-cream">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  background: 'var(--dark)',
                  border: '3px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '4px 4px 0 var(--border-color)',
                }}
              >
                <Terminal size={22} color="white" />
              </div>
              <h2 className="heading-3" style={{ margin: 0 }}>Connect the VS Code Extension</h2>
            </div>
            <p style={{ color: '#555', marginBottom: '20px', lineHeight: 1.5 }}>
              Install the Stereos extension in VS Code to track provenance as you code. One click creates a token and opens the extension to finish setup.
            </p>
            <Link
              to="/settings"
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Terminal size={18} />
              Connect in Settings
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  description,
}: {
  title: string;
  value: number;
  icon: any;
  color: string;
  description: string;
}) {
  return (
    <div className="card" style={{ background: color }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            background: 'var(--dark)',
            border: '3px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '4px 4px 0 var(--border-color)',
          }}
        >
          <Icon size={24} color="white" />
        </div>
        <span
          style={{
            fontSize: '36px',
            fontWeight: 800,
            color: 'var(--dark)',
          }}
        >
          {value.toLocaleString()}
        </span>
      </div>
      <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
        {title}
      </h3>
      <p style={{ fontSize: '14px', color: '#555' }}>{description}</p>
    </div>
  );
}
