import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Brain, Zap, AlertTriangle, Clock, Activity } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon, LLM_PROVIDERS } from '../components/ToolIcon';

interface ToolProfile {
  id: string;
  vendor: string;
  display_name: string;
  vendor_category: string | null;
  total_spans: number;
  total_traces: number;
  total_errors: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

interface Latency {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

interface TimelineBucket {
  hour: string;
  span_count: number;
  error_count: number;
  avg_latency_ms: number;
}

interface Span {
  id: string;
  span_name: string;
  span_kind: string | null;
  duration_ms: number | null;
  status_code: string | null;
  start_time: string;
  trace_id: string;
}

interface ModelUsage {
  model: string;
  request_count: number;
  error_count: number;
  avg_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_used: string;
}

interface DailyUsage {
  day: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  error_count: number;
}

interface LLMStats {
  modelUsage: ModelUsage[];
  dailyUsage: DailyUsage[];
  totals: {
    totalInputTokens: number;
    totalOutputTokens: number;
    distinctModels: number;
  };
}

const LLM_CATEGORIES = ['llm'];

function isLLMProvider(vendorCategory: string | null): boolean {
  return LLM_CATEGORIES.includes(vendorCategory || '');
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

// ── LLM-focused detail view ─────────────────────────────────────────────

function LLMProfileDetail({
  profile,
  latency,
  spans,
}: {
  profile: ToolProfile;
  latency: Latency | undefined;
  buckets: TimelineBucket[];
  spans: Span[];
}) {
  const { profileId } = useParams<{ profileId: string }>();

  const { data: llmData } = useQuery<LLMStats>({
    queryKey: ['tool-profile-llm-stats', profileId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/tool-profiles/${profileId}/llm-stats`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch LLM stats');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const modelUsage = llmData?.modelUsage || [];
  const dailyUsage = llmData?.dailyUsage || [];
  const totals = llmData?.totals || { totalInputTokens: 0, totalOutputTokens: 0, distinctModels: 0 };
  const errorRate = profile.total_spans > 0 ? ((profile.total_errors / profile.total_spans) * 100).toFixed(1) : '0.0';
  const maxDailyRequests = Math.max(1, ...dailyUsage.map((d) => d.request_count));

  return (
    <div>
      {/* Back link */}
      <Link to="/tools" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: 'var(--dark)', fontWeight: 700, textDecoration: 'none' }}>
        <ArrowLeft size={20} /> Back to Tools
      </Link>

      {/* LLM Header with provider badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          marginBottom: '32px',
          padding: '24px',
          background: 'var(--bg-white)',
          border: '3px solid var(--border-color)',
          boxShadow: '4px 4px 0 var(--border-color)',
        }}
      >
        <VendorIcon vendor={profile.vendor} displayName={profile.display_name} size={64} />
        <div style={{ flex: 1 }}>
          <h1 className="heading-1" style={{ marginBottom: '4px' }}>{profile.display_name}</h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '3px 10px',
                background: 'linear-gradient(135deg, #e8d5f5, #d5e8f5)',
                border: '2px solid var(--border-color)',
                letterSpacing: '0.5px',
              }}
            >
              <Brain size={12} style={{ verticalAlign: 'middle', marginRight: '4px', marginTop: '-1px' }} />
              LLM Provider
            </span>
            {totals.distinctModels > 0 && (
              <span style={{ fontSize: '13px', color: '#666', fontWeight: 600 }}>
                {totals.distinctModels} model{totals.distinctModels !== 1 ? 's' : ''} detected
              </span>
            )}
            {profile.last_seen_at && (
              <span style={{ fontSize: '13px', color: '#888' }}>
                Last active {new Date(profile.last_seen_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* LLM Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <Zap size={20} style={{ color: '#f59e0b', marginBottom: '8px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{profile.total_spans.toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Total Requests</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Activity size={20} style={{ color: '#3b82f6', marginBottom: '8px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{formatTokenCount(totals.totalInputTokens)}</div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Input Tokens</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Activity size={20} style={{ color: '#8b5cf6', marginBottom: '8px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{formatTokenCount(totals.totalOutputTokens)}</div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Output Tokens</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <AlertTriangle size={20} style={{ color: Number(errorRate) > 5 ? '#c0392b' : '#888', marginBottom: '8px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800, color: Number(errorRate) > 5 ? '#c0392b' : 'var(--dark)' }}>
            {errorRate}%
          </div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Error Rate</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Clock size={20} style={{ color: '#10b981', marginBottom: '8px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{Math.round(latency?.avg || 0)}ms</div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Avg Latency</div>
        </div>
      </div>

      {/* Two-column layout: Usage chart + Supported Providers */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* Usage over time */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>LLM Requests (last 30 days)</h3>
          {dailyUsage.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '140px' }}>
              {dailyUsage.map((day, i) => {
                const height = Math.max(4, (day.request_count / maxDailyRequests) * 100);
                const errorRatio = day.request_count > 0 ? day.error_count / day.request_count : 0;
                return (
                  <div
                    key={i}
                    title={`${new Date(day.day).toLocaleDateString()}: ${day.request_count} requests, ${formatTokenCount(day.input_tokens + day.output_tokens)} tokens`}
                    style={{
                      flex: 1,
                      height: `${height}%`,
                      background: errorRatio > 0.1
                        ? '#c0392b'
                        : 'linear-gradient(to top, #8b5cf6, #a78bfa)',
                      border: '1px solid var(--border-color)',
                      minWidth: '4px',
                      borderRadius: '2px 2px 0 0',
                      transition: 'height 0.3s ease',
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              No daily data yet
            </div>
          )}
        </div>

        {/* Supported LLM Providers */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Supported LLM Providers</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {LLM_PROVIDERS.map((provider) => {
              const Icon = provider.icon;
              const isCurrentVendor = provider.slug === profile.vendor;
              return (
                <div
                  key={provider.slug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: isCurrentVendor ? 'var(--bg-mint)' : 'var(--bg-cream)',
                    border: `2px solid ${isCurrentVendor ? provider.color : 'var(--border-color)'}`,
                    borderRadius: '0px',
                    transition: 'transform 0.1s ease',
                  }}
                >
                  <Icon size={28} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{provider.displayName}</div>
                  </div>
                  {isCurrentVendor && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        background: provider.color,
                        color: '#fff',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Model Usage Table */}
      {modelUsage.length > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
            <Brain size={18} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
            Model Usage Breakdown
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '3px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Model</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Requests</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Avg Latency</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Input Tokens</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Output Tokens</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Errors</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700 }}>Last Used</th>
                </tr>
              </thead>
              <tbody>
                {modelUsage.map((model) => (
                  <tr key={model.model} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, fontFamily: 'monospace', fontSize: '12px' }}>
                      {model.model}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      {model.request_count.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      {model.avg_latency_ms != null ? `${model.avg_latency_ms}ms` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      {formatTokenCount(model.total_input_tokens)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      {formatTokenCount(model.total_output_tokens)}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          background: model.error_count > 0 ? '#fde8e8' : '#e8fde8',
                          color: model.error_count > 0 ? '#c0392b' : '#27ae60',
                          border: '1px solid currentColor',
                        }}
                      >
                        {model.error_count}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#888', whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {model.last_used ? new Date(model.last_used).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Latency Distribution */}
      {latency && latency.p99 > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Latency Distribution</h3>
          {(['p50', 'p95', 'p99'] as const).map((key) => {
            const value = latency[key];
            const pct = latency.p99 > 0 ? Math.max(2, (value / latency.p99) * 100) : 0;
            return (
              <div key={key} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                  <span style={{ textTransform: 'uppercase' }}>{key}</span>
                  <span>{Math.round(value)}ms</span>
                </div>
                <div style={{ height: '12px', background: 'var(--bg-cream)', border: '2px solid var(--border-color)' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: key === 'p99' ? '#c0392b' : key === 'p95' ? '#8b5cf6' : '#a78bfa',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Spans */}
      <div className="card">
        <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Recent LLM Calls</h3>
        {spans.length === 0 ? (
          <p style={{ color: '#888' }}>No spans recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '3px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Name</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Kind</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Duration</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {spans.map((span) => (
                  <tr key={span.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {span.span_name}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{span.span_kind || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                      {span.duration_ms != null ? `${span.duration_ms}ms` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          background: span.status_code === 'ERROR' ? '#fde8e8' : span.status_code === 'OK' ? '#e8fde8' : '#f0f0f0',
                          color: span.status_code === 'ERROR' ? '#c0392b' : span.status_code === 'OK' ? '#27ae60' : '#888',
                          border: '1px solid currentColor',
                        }}
                      >
                        {span.status_code || 'UNSET'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#888', whiteSpace: 'nowrap' }}>
                      {new Date(span.start_time).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Standard (non-LLM) detail view ──────────────────────────────────────

function StandardProfileDetail({
  profile,
  latency,
  buckets,
  spans,
}: {
  profile: ToolProfile;
  latency: Latency | undefined;
  buckets: TimelineBucket[];
  spans: Span[];
}) {
  const errorRate = profile.total_spans > 0 ? ((profile.total_errors / profile.total_spans) * 100).toFixed(1) : '0.0';
  const maxSpanCount = Math.max(1, ...buckets.map((b) => b.span_count));

  return (
    <div>
      {/* Back link */}
      <Link to="/tools" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: 'var(--dark)', fontWeight: 700, textDecoration: 'none' }}>
        <ArrowLeft size={20} /> Back to Tools
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <VendorIcon vendor={profile.vendor} displayName={profile.display_name} size={56} />
        <div>
          <h1 className="heading-1" style={{ marginBottom: '4px' }}>{profile.display_name}</h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {profile.vendor_category && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  background: 'var(--bg-mint)',
                  border: '2px solid var(--border-color)',
                }}
              >
                {profile.vendor_category}
              </span>
            )}
            {profile.first_seen_at && (
              <span style={{ fontSize: '13px', color: '#888' }}>
                First seen {new Date(profile.first_seen_at).toLocaleDateString()}
              </span>
            )}
            {profile.last_seen_at && (
              <span style={{ fontSize: '13px', color: '#888' }}>
                Last seen {new Date(profile.last_seen_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid-3" style={{ marginBottom: '32px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 800 }}>{profile.total_spans.toLocaleString()}</div>
          <div style={{ fontSize: '14px', color: '#555', fontWeight: 600 }}>Total Spans</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 800, color: Number(errorRate) > 5 ? '#c0392b' : 'var(--dark)' }}>
            {errorRate}%
          </div>
          <div style={{ fontSize: '14px', color: '#555', fontWeight: 600 }}>Error Rate</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 800 }}>{Math.round(latency?.avg || 0)}ms</div>
          <div style={{ fontSize: '14px', color: '#555', fontWeight: 600 }}>Avg Latency</div>
        </div>
      </div>

      {/* Activity Timeline */}
      {buckets.length > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Activity (last 24h)</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '120px' }}>
            {buckets.map((bucket, i) => {
              const height = Math.max(4, (bucket.span_count / maxSpanCount) * 100);
              const errorRatio = bucket.span_count > 0 ? bucket.error_count / bucket.span_count : 0;
              return (
                <div
                  key={i}
                  title={`${new Date(bucket.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${bucket.span_count} spans, ${bucket.error_count} errors`}
                  style={{
                    flex: 1,
                    height: `${height}%`,
                    background: errorRatio > 0.1 ? '#c0392b' : 'var(--dark)',
                    border: '1px solid var(--border-color)',
                    minWidth: '4px',
                    transition: 'height 0.3s ease',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Latency bars */}
      {latency && latency.p99 > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Latency Distribution</h3>
          {(['p50', 'p95', 'p99'] as const).map((key) => {
            const value = latency[key];
            const pct = latency.p99 > 0 ? Math.max(2, (value / latency.p99) * 100) : 0;
            return (
              <div key={key} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                  <span style={{ textTransform: 'uppercase' }}>{key}</span>
                  <span>{Math.round(value)}ms</span>
                </div>
                <div style={{ height: '12px', background: 'var(--bg-cream)', border: '2px solid var(--border-color)' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: key === 'p99' ? '#c0392b' : key === 'p95' ? 'var(--bg-lavender)' : 'var(--bg-mint)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Spans */}
      <div className="card">
        <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Recent Spans</h3>
        {spans.length === 0 ? (
          <p style={{ color: '#888' }}>No spans recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '3px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Name</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Kind</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Duration</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {spans.map((span) => (
                  <tr key={span.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {span.span_name}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{span.span_kind || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                      {span.duration_ms != null ? `${span.duration_ms}ms` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          background: span.status_code === 'ERROR' ? '#fde8e8' : span.status_code === 'OK' ? '#e8fde8' : '#f0f0f0',
                          color: span.status_code === 'ERROR' ? '#c0392b' : span.status_code === 'OK' ? '#27ae60' : '#888',
                          border: '1px solid currentColor',
                        }}
                      >
                        {span.status_code || 'UNSET'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#888', whiteSpace: 'nowrap' }}>
                      {new Date(span.start_time).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────

export function ToolProfileDetail() {
  const { profileId } = useParams<{ profileId: string }>();

  const { data: profileData, isLoading: profileLoading } = useQuery<{ profile: ToolProfile; latency: Latency }>({
    queryKey: ['tool-profile', profileId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/tool-profiles/${profileId}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch profile');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const { data: timelineData } = useQuery<{ buckets: TimelineBucket[] }>({
    queryKey: ['tool-profile-timeline', profileId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/tool-profiles/${profileId}/timeline`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch timeline');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const { data: spansData } = useQuery<{ spans: Span[] }>({
    queryKey: ['tool-profile-spans', profileId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/tool-profiles/${profileId}/spans?limit=20`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch spans');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  if (profileLoading) {
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

  const profile = profileData?.profile;
  const latency = profileData?.latency;
  const buckets = timelineData?.buckets || [];
  const spans = spansData?.spans || [];

  if (!profile) {
    return (
      <div>
        <Link to="/tools" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: 'var(--dark)', fontWeight: 700, textDecoration: 'none' }}>
          <ArrowLeft size={20} /> Back to Tools
        </Link>
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p>Tool profile not found.</p>
        </div>
      </div>
    );
  }

  // Conditionally render LLM-focused view
  if (isLLMProvider(profile.vendor_category)) {
    return (
      <LLMProfileDetail
        profile={profile}
        latency={latency}
        buckets={buckets}
        spans={spans}
      />
    );
  }

  return (
    <StandardProfileDetail
      profile={profile}
      latency={latency}
      buckets={buckets}
      spans={spans}
    />
  );
}
