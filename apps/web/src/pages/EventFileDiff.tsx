import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { ToolIcon } from '../components/ToolIcon';
import { DiffView } from '../components/DiffView';

interface FileDiffData {
  event: {
    id: string;
    intent: string;
    actor_id: string;
    tool: string;
    model: string | null;
    timestamp: string;
    user: {
      id: string;
      name: string | null;
      image: string | null;
      email: string;
    } | null;
  };
  file_path: string;
  diff: { path: string; hunks: { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: { type: string; content: string }[] }[] } | null;
}

export function EventFileDiff() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const filePath = searchParams.get('path');

  const { data, isLoading, error } = useQuery<FileDiffData>({
    queryKey: ['event-file', eventId, filePath],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE}/v1/events/${eventId}/file?path=${encodeURIComponent(filePath || '')}`,
        {
          credentials: 'include',
          headers: getAuthHeaders(),
        }
      );
      if (!response.ok) {
        if (response.status === 404) throw new Error('File not found in this event');
        throw new Error('Failed to fetch file diff');
      }
      return response.json();
    },
    enabled: !!filePath,
  });

  if (!filePath) {
    return (
      <div className="card" style={{ padding: '24px' }}>
        <p style={{ color: '#555', marginBottom: '16px' }}>No file path specified.</p>
        <Link to="/events" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          ← Back to events
        </Link>
      </div>
    );
  }

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
        <p style={{ color: '#555' }}>Loading file diff…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: '24px' }}>
        <p style={{ color: '#555', marginBottom: '16px' }}>
          {error instanceof Error ? error.message : 'File not found'}
        </p>
        <Link
          to={`/events/${eventId}`}
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >
          ← Back to event
        </Link>
      </div>
    );
  }

  const { event, diff } = data;
  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <Link
          to={`/events/${eventId}`}
          className="btn"
          style={{ display: 'inline-flex', textDecoration: 'none' }}
        >
          ← Back to event
        </Link>
      </div>

      {/* File header card */}
      <div className="card" style={{ marginBottom: '24px' }}>
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
              fontSize: '24px',
            }}
          >
            <ToolIcon actorId={event.actor_id} tool={event.tool} size={32} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              className="heading-1"
              style={{
                marginBottom: '4px',
                fontSize: '22px',
                wordBreak: 'break-all',
                overflowWrap: 'break-word',
              }}
            >
              {fileName}
            </h1>
            <p
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '13px',
                color: '#666',
                marginBottom: '12px',
                wordBreak: 'break-all',
                overflowWrap: 'break-word',
              }}
            >
              {filePath}
            </p>
            <p style={{ color: '#555', fontSize: '14px', margin: 0 }}>
              {event.intent} · {event.actor_id} · {event.tool}
              {event.model ? ` · ${event.model}` : ''}
            </p>
            <p style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
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

      {/* Diff content */}
      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px' }}>
          Diff
        </h2>
        {diff ? (
          <DiffView content={JSON.stringify([diff])} maxHeight="none" />
        ) : (
          <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
            No diff content available for this file.
          </p>
        )}
      </div>
    </div>
  );
}
