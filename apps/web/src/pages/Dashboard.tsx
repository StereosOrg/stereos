import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Layers, Users } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon } from '../components/ToolIcon';

interface DashboardSpan {
  id: string;
  intent: string;
  vendor: string;
  model?: string | null;
  timestamp: string;
  tool_profile_id?: string | null;
}

interface DashboardStats {
  total_spans: number;
  total_traces: number;
  active_sources: number;
  recent_spans: DashboardSpan[];
  most_active_user: { id: string; name: string | null; email: string | null; span_count: number } | null;
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
            border: '2px solid var(--border-default)',
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
          Live system view powered by spans.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid-3" style={{ marginBottom: '40px' }}>
        <StatCard
          title="Total Spans"
          value={stats?.total_spans || 0}
          icon={Activity}
          color="var(--bg-white)"
          description="All ingested spans"
        />
        <StatCard
          title="Total Traces"
          value={stats?.total_traces || 0}
          icon={Layers}
          color="var(--bg-white)"
          description="Distinct traces"
        />
        <StatCard
          title="Most Active User"
          value={stats?.most_active_user?.span_count ?? 0}
          icon={Users}
          color="var(--bg-white)"
          description={stats?.most_active_user ? `${stats.most_active_user.name || stats.most_active_user.email || 'Unknown'} · 30d` : 'No user activity'}
        />
      </div>

      {/* Main Content Area */}
      <div className="grid-2">
        {/* Recent Spans */}
        <div className="card" style={{ minHeight: '400px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                background: 'var(--dark)',
                border: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Activity size={20} color="white" />
            </div>
            <h2 className="heading-3">Recent Spans</h2>
          </div>
          
          {!stats?.recent_spans?.length ? (
            <div
              style={{
                background: 'var(--bg-white)',
                border: '1px solid var(--border-default)',
                padding: '32px',
                textAlign: 'center',
              }}
            >
              <p style={{ color: '#666', marginBottom: '16px' }}>
                No spans yet. Start ingesting!
              </p>
              <Link to="/settings" className="btn btn-primary" style={{ display: 'inline-flex' }}>
                Manage API Keys
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stats.recent_spans.map((event) => {
                const href = `/spans/${event.id}`;
                return (
                <Link
                  key={event.id}
                  to={href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border-subtle)',
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
                      width: '44px',
                      height: '44px',
                      borderRadius: '8px',
                      background: 'var(--bg-mint)',
                      border: '1px solid var(--border-default)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <VendorIcon
                      vendor={event.vendor}
                      displayName={event.vendor}
                      size={24}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, lineHeight: 1.3 }}>
                      {event.intent}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>
                      {event.vendor}
                      {event.model ? ` · ${event.model}` : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: '13px', color: '#666', flexShrink: 0 }}>
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                </Link>
              );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div>
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 className="heading-3">Quick Actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Link to="/settings" className="btn" style={{ justifyContent: 'flex-start' }}>
                <Activity size={18} />
                API Keys
              </Link>
              <Link to="/users" className="btn" style={{ justifyContent: 'flex-start' }}>
                <Users size={18} />
                Team
              </Link>
            </div>
          </div>

          <div className="card">
            <h2 className="heading-3" style={{ marginBottom: '12px' }}>Get data flowing</h2>
            <p style={{ color: '#555', marginBottom: '16px', lineHeight: 1.5 }}>
              Connect your tools and start emitting OTLP spans to see activity here.
            </p>
            <Link to="/settings" className="btn btn-primary" style={{ display: 'inline-flex' }}>
              Manage API Keys
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
            border: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-sm)',
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
