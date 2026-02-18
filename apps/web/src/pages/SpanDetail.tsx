import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon, getVendorBrand } from '../components/ToolIcon';

interface Span {
  id: string;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  span_name: string;
  span_kind: string | null;
  vendor: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
  status_code: string | null;
  status_message: string | null;
  service_name: string | null;
  span_attributes: Record<string, unknown> | null;
  resource_attributes: Record<string, unknown> | null;
  user_id: string | null;
  team_id: string | null;
}

export function SpanDetail() {
  const { spanId } = useParams<{ spanId: string }>();

  const { data, isLoading, error } = useQuery<{ span: Span }>({
    queryKey: ['span', spanId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/spans/${spanId}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch span');
      return res.json();
    },
    enabled: !!spanId,
  });

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '2px solid var(--border-default)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ color: '#555' }}>Loading span…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data?.span) {
    return (
      <div className="card" style={{ padding: '24px', background: 'var(--bg-pink)', border: '1px solid #dc2626' }}>
        <h2 className="heading-3" style={{ marginBottom: '8px', color: '#991b1b' }}>Error</h2>
        <p style={{ color: '#555' }}>Unable to load span.</p>
      </div>
    );
  }

  const span = data.span;
  const model =
    (span.span_attributes as Record<string, string> | null)?.['gen_ai.request.model'] ??
    (span.span_attributes as Record<string, string> | null)?.['gen_ai.response.model'] ??
    null;
  const brand = getVendorBrand(model ?? span.span_name ?? span.vendor) ?? { key: span.vendor, label: span.vendor };

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <Link to="/" className="btn" style={{ textDecoration: 'none' }}>← Back to dashboard</Link>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '8px',
              background: 'var(--bg-mint)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <VendorIcon vendor={brand.key} displayName={brand.label} size={28} />
          </div>
          <div>
            <h1 className="heading-2" style={{ margin: 0 }}>{span.span_name}</h1>
            <p style={{ color: '#555', margin: '4px 0 0', fontSize: '14px' }}>
              {brand.label}{model ? ` · ${model}` : ''}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <Field label="Status" value={span.status_code ?? 'OK'} />
          {span.status_message && <Field label="Status message" value={span.status_message} />}
          <Field label="Start time" value={new Date(span.start_time).toLocaleString()} />
          {span.end_time && <Field label="End time" value={new Date(span.end_time).toLocaleString()} />}
          {span.duration_ms != null && <Field label="Duration" value={`${span.duration_ms.toLocaleString()} ms`} />}
          {span.span_kind && <Field label="Span kind" value={span.span_kind} />}
          {span.service_name && <Field label="Service" value={span.service_name} />}
          {span.trace_id && <Field label="Trace ID" value={span.trace_id} mono />}
          {span.span_id && <Field label="Span ID" value={span.span_id} mono />}
          {span.parent_span_id && <Field label="Parent span ID" value={span.parent_span_id} mono />}
          {span.user_id && <Field label="User ID" value={span.user_id} mono />}
          {span.team_id && <Field label="Team ID" value={span.team_id} mono />}
        </div>
      </div>

      {span.span_attributes && Object.keys(span.span_attributes).length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h2 className="heading-3" style={{ marginBottom: '16px' }}>Span Attributes</h2>
          <pre
            style={{
              background: 'var(--bg-cream)',
              border: '1px solid var(--border-default)',
              padding: '16px',
              overflow: 'auto',
              fontSize: '13px',
              lineHeight: 1.5,
              maxHeight: '500px',
            }}
          >
            {JSON.stringify(span.span_attributes, null, 2)}
          </pre>
        </div>
      )}

      {span.resource_attributes && Object.keys(span.resource_attributes).length > 0 && (
        <div className="card">
          <h2 className="heading-3" style={{ marginBottom: '16px' }}>Resource Attributes</h2>
          <pre
            style={{
              background: 'var(--bg-cream)',
              border: '1px solid var(--border-default)',
              padding: '16px',
              overflow: 'auto',
              fontSize: '13px',
              lineHeight: 1.5,
              maxHeight: '500px',
            }}
          >
            {JSON.stringify(span.resource_attributes, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '12px', color: '#555', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  );
}
