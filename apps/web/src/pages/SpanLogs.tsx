import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon, getVendorBrand } from '../components/ToolIcon';

interface SpanRow {
  id: string;
  span_name: string;
  vendor: string;
  start_time: string;
  status_code: string | null;
  span_attributes: Record<string, unknown> | null;
  user_id: string | null;
  team_id: string | null;
}

interface SpanLogsResponse {
  spans: SpanRow[];
  limit: number;
  offset: number;
}

export function SpanLogs() {
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, isFetching } = useQuery<SpanLogsResponse>({
    queryKey: ['span-logs', limit, offset],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/spans?limit=${limit}&offset=${offset}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch span logs');
      return res.json();
    },
  });

  const spans = data?.spans ?? [];

  return (
    <div>
      <div className="card" style={{ marginBottom: '24px' }}>
        <h1 className="heading-1" style={{ margin: 0 }}>Span logs</h1>
        <p style={{ color: '#555', margin: '6px 0 0' }}>Observability-only. Usage and billing comes from Gateway events.</p>
      </div>

      <div className="card">
        {isLoading ? (
          <p style={{ color: '#666' }}>Loading spans…</p>
        ) : error ? (
          <p style={{ color: '#991b1b' }}>Unable to load spans.</p>
        ) : spans.length === 0 ? (
          <p style={{ color: '#666' }}>No spans yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {spans.map((s) => {
              const model =
                (s.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ??
                (s.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ??
                null;
              const brand = getVendorBrand(model ?? s.span_name ?? s.vendor) ?? { key: s.vendor, label: s.vendor };
              return (
                <Link
                  key={s.id}
                  to={`/spans/${s.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: 'var(--bg-mint)',
                    border: '1px solid var(--border-default)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <VendorIcon vendor={brand.key} displayName={brand.label} size={28} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{s.span_name}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {brand.label}
                      {model ? ` · ${model}` : ''}
                      {s.status_code ? ` · ${s.status_code}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{new Date(s.start_time).toLocaleString()}</div>
                </Link>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
          <button
            type="button"
            className="btn"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0 || isFetching}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setOffset(offset + limit)}
            disabled={spans.length < limit || isFetching}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
