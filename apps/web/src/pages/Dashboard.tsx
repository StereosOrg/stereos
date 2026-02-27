import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Users, DollarSign, UserCheck, Zap } from 'lucide-react';
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
  total_spend: number;
  active_users: number;
  recent_spans: DashboardSpan[];
  most_active_user: { id: string; name: string | null; email: string | null; span_count: number } | null;
}

interface GatewayEvent {
  id: string;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  status_code: number;
  duration_ms: number;
  created_at: string;
}

interface AiKeyItem {
  id: string;
  spend_usd: string;
}

export function Dashboard() {
  const { data: meData } = useQuery<{ user: { id: string; role?: string }; stats: { total_events: string }; team: { team_id: string; team_name: string | null } | null }>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
  });

  const isAdminOrManager = meData?.user?.role === 'admin' || meData?.user?.role === 'manager';

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
    enabled: isAdminOrManager,
  });

  const { data: userKeysData } = useQuery<{ keys: AiKeyItem[] }>({
    queryKey: ['my-keys'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/keys/user`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch keys');
      return res.json();
    },
    enabled: !isAdminOrManager,
  });

  const { data: gatewayEventsData } = useQuery<{ events: GatewayEvent[] }>({
    queryKey: ['gateway-events-me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/gateway-events/me`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch gateway events');
      return res.json();
    },
    enabled: !isAdminOrManager,
  });

  if (!meData || (isLoading && isAdminOrManager)) {
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
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAdminOrManager && meData) {
    const userSpend = (userKeysData?.keys ?? []).reduce(
      (sum, k) => sum + parseFloat(String(k.spend_usd ?? '0')),
      0
    );
    const totalEvents = parseInt(String(meData.stats?.total_events ?? '0'));
    const teamName = meData.team?.team_name ?? '—';
    const recentEvents = gatewayEventsData?.events ?? [];

    return (
      <div>
        <div style={{ marginBottom: '40px' }}>
          <h1 className="heading-1">Dashboard</h1>
          <p className="text-large">Your personal activity overview.</p>
        </div>

        <div className="grid-3" style={{ marginBottom: '40px' }}>
          <StatCard
            title="User Spend"
            value={userSpend}
            icon={DollarSign}
            color="var(--bg-white)"
            description="Your AI gateway spend (USD)"
            format="currency"
          />
          <StatCard
            title="Total Events"
            value={totalEvents}
            icon={Activity}
            color="var(--bg-white)"
            description="Your total recorded spans"
          />
          <div className="card" style={{ background: 'var(--bg-white)' }}>
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
                <Users size={24} color="white" />
              </div>
              <span style={{ fontSize: '28px', fontWeight: 800, color: 'var(--dark)', maxWidth: '60%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {teamName}
              </span>
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>Team</h3>
            <p style={{ fontSize: '14px', color: '#555' }}>Your assigned team</p>
          </div>
        </div>

        <div className="grid-2">
          {/* Gateway Events */}
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
                <Zap size={20} color="white" />
              </div>
              <h2 className="heading-3">Gateway Events</h2>
            </div>

            {!recentEvents.length ? (
              <div
                style={{
                  background: 'var(--bg-white)',
                  border: '1px solid var(--border-default)',
                  padding: '32px',
                  textAlign: 'center',
                }}
              >
                <p style={{ color: '#666', marginBottom: '16px' }}>
                  No gateway events yet. Connect to the AI Gateway to get started.
                </p>
                <Link to="/ai-gateway" className="btn btn-primary" style={{ display: 'inline-flex' }}>
                  AI Gateway Setup
                </Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {recentEvents.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '16px 20px',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: 'var(--bg-white)',
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
                      <VendorIcon vendor={event.provider} displayName={event.provider} size={24} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }}>
                        {event.model}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>
                        {event.provider} · {event.total_tokens.toLocaleString()} tokens
                        {event.status_code !== 200 ? ` · ${event.status_code}` : ''}
                      </p>
                    </div>
                    <span style={{ fontSize: '13px', color: '#666', flexShrink: 0 }}>
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div>
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 className="heading-3">Quick Actions</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Link to="/ai-gateway" className="btn" style={{ justifyContent: 'flex-start' }}>
                  <Zap size={18} />
                  AI Gateway
                </Link>
                <Link to="/users" className="btn" style={{ justifyContent: 'flex-start' }}>
                  <Users size={18} />
                  Team
                </Link>
              </div>
            </div>

            <div className="card">
              <h2 className="heading-3" style={{ marginBottom: '12px' }}>Connect to AI Gateway</h2>
              <p style={{ color: '#555', marginBottom: '16px', lineHeight: 1.5 }}>
                Route your AI calls through the gateway to track usage and costs.
              </p>
              <Link to="/ai-gateway" className="btn btn-primary" style={{ display: 'inline-flex' }}>
                Get Started
              </Link>
            </div>
          </div>
        </div>
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
          title="Total Spend"
          value={stats?.total_spend || 0}
          icon={DollarSign}
          color="var(--bg-white)"
          description="AI usage costs (USD)"
          format="currency"
        />
        <StatCard
          title="Active Users"
          value={stats?.active_users || 0}
          icon={UserCheck}
          color="var(--bg-white)"
          description="Users with activity · 30d"
        />
        <StatCard
          title="Total Spans"
          value={stats?.total_spans || 0}
          icon={Activity}
          color="var(--bg-white)"
          description="All ingested spans"
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
  format,
}: {
  title: string;
  value: number;
  icon: any;
  color: string;
  description: string;
  format?: 'number' | 'currency';
}) {
  const displayValue = format === 'currency'
    ? `$${value.toFixed(2)}`
    : value.toLocaleString();

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
          {displayValue}
        </span>
      </div>
      <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
        {title}
      </h3>
      <p style={{ fontSize: '14px', color: '#555' }}>{description}</p>
    </div>
  );
}
