import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../lib/api';

export function ProvenanceView() {
  const [commitSha, setCommitSha] = useState('');
  const [searchSha, setSearchSha] = useState('');

  const { data: events, isLoading } = useQuery({
    queryKey: ['provenance', searchSha],
    queryFn: async () => {
      if (!searchSha) return [];
      const response = await fetch(`${API_BASE}/v1/provenance/by-commit/${searchSha}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token')}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      return data.events;
    },
    enabled: !!searchSha,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchSha(commitSha);
  };

  return (
    <div>
      <h2 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '24px' }}>
        Provenance by Commit
      </h2>

      <form onSubmit={handleSearch} style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <input
            type="text"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            placeholder="Enter commit SHA..."
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #374151',
              backgroundColor: '#111118',
              color: '#e2e8f0',
              fontSize: '14px',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#3b82f6',
              color: 'white',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            Search
          </button>
        </div>
      </form>

      {isLoading && <p>Loading...</p>}

      {events && events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {events.map((event: any) => (
            <div
              key={event.id}
              style={{
                backgroundColor: '#111118',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid #1f2937',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    color: '#60a5fa',
                    backgroundColor: '#1e3a5f',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}
                >
                  {event.actor_id}
                </span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              <h4 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                {event.intent}
              </h4>
              <p style={{ fontSize: '13px', color: '#9ca3af' }}>
                Tool: {event.tool}
                {event.model && ` • Model: ${event.model}`}
              </p>
              {event.files_written && event.files_written.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                    Files written:
                  </p>
                  {event.files_written.map((file: string) => (
                    <code
                      key={file}
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: '#9ca3af',
                        fontFamily: 'monospace',
                      }}
                    >
                      {file}
                    </code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {events && events.length === 0 && searchSha && (
        <p style={{ color: '#6b7280' }}>
          No provenance events found for commit {searchSha}
        </p>
      )}
    </div>
  );
}
