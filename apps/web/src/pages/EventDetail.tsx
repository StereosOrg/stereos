import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { ToolIcon } from '../components/ToolIcon';
import { DiffView } from '../components/DiffView';

interface Artifact {
  id: string;
  repo: string;
  branch: string | null;
  commit: string | null;
  diff_hash: string | null;
  diff_content: string | null;
}

interface Outcome {
  id: string;
  status: string;
  linked_commit: string | null;
}

interface EventDetailData {
  event: {
    id: string;
    actor_id: string;
    actor_type: string;
    tool: string;
    model: string | null;
    intent: string;
    timestamp: string;
    files_written: string[] | null;
    user_id: string | null;
    user: {
      id: string;
      name: string | null;
      image: string | null;
      email: string;
    } | null;
    artifacts: Artifact[];
    outcomes: Outcome[];
  };
}

export function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();

  const { data, isLoading, error } = useQuery<EventDetailData>({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/v1/events/${eventId}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) throw new Error('Event not found');
        throw new Error('Failed to fetch event');
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
        <p style={{ color: '#555' }}>Loading event…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data?.event) {
    return (
      <div className="card" style={{ padding: '24px' }}>
        <p style={{ color: '#555', marginBottom: '16px' }}>
          {error instanceof Error ? error.message : 'Event not found'}
        </p>
        <Link to="/events" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          ← Back to events
        </Link>
      </div>
    );
  }

  const { event } = data;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Link
          to="/events"
          className="btn"
          style={{ display: 'inline-flex', textDecoration: 'none' }}
        >
          ← Back to events
        </Link>
      </div>

      {/* Two columns: intent (e.g. "Modified 1 file(s)") | Artifacts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        {/* Left: intent / header card */}
        <div className="card" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '10px',
                background: 'var(--bg-mint)',
                border: '3px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--dark)',
                flexShrink: 0,
              }}
            >
              <ToolIcon actorId={event.actor_id} tool={event.tool} size={32} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="heading-1" style={{ marginBottom: '8px', fontSize: '28px' }}>
                {event.intent}
              </h1>
              <p style={{ color: '#555', marginBottom: '12px' }}>
                {event.actor_id} · {event.tool}
                {event.model ? ` · ${event.model}` : ''}
              </p>
              <p style={{ fontSize: '14px', color: '#666' }}>
                {new Date(event.timestamp).toLocaleString()}
              </p>
            </div>
            {event.user && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 14px',
                  background: 'var(--bg-lavender)',
                  border: '2px solid var(--border-color)',
                }}
              >
                {event.user.image ? (
                  <img
                    src={event.user.image}
                    alt=""
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '6px',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '6px',
                      background: 'var(--dark)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: 700,
                    }}
                  >
                    {event.user.name?.charAt(0) || event.user.email.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p style={{ fontWeight: 600, margin: 0, fontSize: '14px' }}>
                    {event.user.name || 'Unnamed'}
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#555' }}>
                    {event.user.email}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Artifacts card */}
        <div className="card" style={{ minWidth: 0 }}>
          <h2 className="heading-3" style={{ marginBottom: '16px' }}>
            Artifacts
          </h2>
          {event.artifacts && event.artifacts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {event.artifacts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: '12px 16px',
                    background: 'var(--bg-cream)',
                    border: '2px solid var(--border-color)',
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <p style={{ fontWeight: 600, margin: '0 0 4px', wordBreak: 'break-word' }}>{a.repo}</p>
                  {a.branch && (
                    <p style={{ fontSize: '14px', color: '#555', margin: 0, wordBreak: 'break-word' }}>
                      Branch: {a.branch}
                    </p>
                  )}
                  {a.commit && (
                    <p
                      style={{
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        color: '#666',
                        margin: '4px 0 0',
                        wordBreak: 'break-all',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {a.commit}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>No artifacts linked.</p>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}
      >
        {/* Diff content for artifacts that have it */}
        {event.artifacts?.some((a) => a.diff_content) && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2 className="heading-3" style={{ marginBottom: '16px' }}>
              Diff
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {event.artifacts
                .filter((a) => a.diff_content)
                .map((a) => (
                  <div key={a.id}>
                    <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: '#555' }}>
                      {a.repo}
                      {a.branch ? ` @ ${a.branch}` : ''}
                      {a.commit ? ` · ${a.commit.slice(0, 8)}` : ''}
                    </p>
                    <DiffView content={a.diff_content!} />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Outcomes */}
        {event.outcomes && event.outcomes.length > 0 && (
          <div className="card">
            <h2 className="heading-3" style={{ marginBottom: '16px' }}>
              Outcomes
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {event.outcomes.map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background:
                      o.status === 'accepted'
                        ? 'var(--bg-mint)'
                        : o.status === 'rejected'
                          ? 'var(--bg-pink)'
                          : 'var(--bg-lavender)',
                    border: '2px solid var(--border-color)',
                  }}
                >
                  <span className="badge" style={{ textTransform: 'capitalize' }}>
                    {o.status}
                  </span>
                  {o.linked_commit && (
                    <code style={{ fontSize: '12px' }}>{o.linked_commit}</code>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Files written */}
        {event.files_written && event.files_written.length > 0 && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2 className="heading-3" style={{ marginBottom: '16px' }}>
              Files written
            </h2>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              {event.files_written.map((path, i) => (
                <code
                  key={i}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-mint)',
                    border: '2px solid var(--border-color)',
                    fontSize: '13px',
                  }}
                >
                  {path}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
