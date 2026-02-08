import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { ToolIcon } from '../components/ToolIcon';

export function EventsSearch() {
  const [filters, setFilters] = useState({
    actor_id: '',
    tool: '',
    intent: '',
    start_date: '',
    end_date: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['events', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });

      const response = await fetch(`${API_BASE}/v1/events/search?${params}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
  });

  return (
    <div>
      <h1 className="heading-1" style={{ marginBottom: '8px' }}>
        Events
      </h1>
      <p className="text-large" style={{ marginBottom: '32px', color: '#555' }}>
        Search provenance events by actor, tool, and intent.
      </p>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>
          Filters
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '16px',
          }}
        >
          <input
            type="text"
            className="input"
            placeholder="Actor ID"
            value={filters.actor_id}
            onChange={(e) =>
              setFilters({ ...filters, actor_id: e.target.value })
            }
          />
          <input
            type="text"
            className="input"
            placeholder="Tool"
            value={filters.tool}
            onChange={(e) => setFilters({ ...filters, tool: e.target.value })}
          />
          <input
            type="text"
            className="input"
            placeholder="Intent search"
            value={filters.intent}
            onChange={(e) => setFilters({ ...filters, intent: e.target.value })}
          />
          <input
            type="date"
            className="input"
            value={filters.start_date}
            onChange={(e) =>
              setFilters({ ...filters, start_date: e.target.value })
            }
          />
          <input
            type="date"
            className="input"
            value={filters.end_date}
            onChange={(e) =>
              setFilters({ ...filters, end_date: e.target.value })
            }
          />
        </div>
      </div>

      {isLoading && (
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
          <p style={{ color: '#555' }}>Loading events…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {!isLoading && data?.events && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {data.events.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#555' }}>
              No events match your filters.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {data.events.map((event: any) => (
                <Link
                  key={event.id}
                  to={`/events/${event.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 24px',
                    borderBottom: 'var(--border-width) solid var(--border-color)',
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
                  {/* User avatar (creator) */}
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
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: '16px',
                          fontWeight: 700,
                          color: 'white',
                        }}
                      >
                        {event.user?.name?.charAt(0) ||
                          event.user?.email?.charAt(0)?.toUpperCase() ||
                          '?'}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '8px',
                      background: 'var(--bg-mint)',
                      border: '2px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--dark)',
                      flexShrink: 0,
                    }}
                  >
                    <ToolIcon
                      actorId={event.actor_id}
                      tool={event.tool}
                      size={28}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      className="heading-3"
                      style={{
                        margin: 0,
                        fontSize: '18px',
                        fontWeight: 600,
                        lineHeight: 1.3,
                      }}
                    >
                      {event.intent}
                    </p>
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: '14px',
                        color: '#555',
                      }}
                    >
                      {event.actor_id} · {event.tool}
                      {event.model ? ` · ${event.model}` : ''}
                    </p>
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#666',
                      flexShrink: 0,
                    }}
                  >
                    {new Date(event.timestamp).toLocaleString()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
