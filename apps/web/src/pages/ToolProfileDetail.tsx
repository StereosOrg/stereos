import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Brain, Zap, AlertTriangle, Clock, Activity, ChevronDown, ChevronRight, Hash, Gauge, TrendingUp, Layers } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { VendorIcon } from '../components/ToolIcon';

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
  status_message: string | null;
  start_time: string;
  end_time: string | null;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string | null;
  vendor: string;
  span_attributes: Record<string, string> | null;
  resource_attributes: Record<string, string> | null;
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

interface HourlyTokens {
  hour: string;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  avg_latency_ms: number;
}

interface ModelLatency {
  model: string;
  p50: number;
  p95: number;
  p99: number;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
}

interface TopOperation {
  span_name: string;
  call_count: number;
  avg_latency_ms: number;
  error_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface LLMStats {
  modelUsage: ModelUsage[];
  dailyUsage: DailyUsage[];
  hourlyTokens: HourlyTokens[];
  modelLatency: ModelLatency[];
  topOperations: TopOperation[];
  totals: {
    totalInputTokens: number;
    totalOutputTokens: number;
    distinctModels: number;
    avgDurationMs: number;
    avgTokensPerSec: number;
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

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

// Extract gen_ai.* attributes from span_attributes
function getGenAIAttrs(attrs: Record<string, string> | null): Record<string, string> {
  if (!attrs) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('gen_ai.')) {
      result[key] = value;
    }
  }
  return result;
}

// Pretty label for gen_ai attribute keys
function formatAttrKey(key: string): string {
  return key
    .replace('gen_ai.', '')
    .replace('request.', '')
    .replace('response.', 'resp.')
    .replace('usage.', '')
    .replace(/_/g, ' ');
}

// ── Expandable span row ──────────────────────────────────────────────────

function SpanRow({ span }: { span: Span }) {
  const [expanded, setExpanded] = useState(false);
  const genAI = getGenAIAttrs(span.span_attributes);
  const hasGenAI = Object.keys(genAI).length > 0;
  const model = span.span_attributes?.['gen_ai.request.model'] || span.span_attributes?.['gen_ai.response.model'] || null;
  const inputTokens = span.span_attributes?.['gen_ai.usage.input_tokens'];
  const outputTokens = span.span_attributes?.['gen_ai.usage.output_tokens'];

  return (
    <>
      <tr
        style={{ borderBottom: expanded ? 'none' : '1px solid #eee', cursor: hasGenAI ? 'pointer' : 'default' }}
        onClick={() => hasGenAI && setExpanded(!expanded)}
      >
        <td style={{ padding: '8px 12px', fontWeight: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {hasGenAI && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
            <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
              {span.span_name}
            </span>
          </div>
        </td>
        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px', color: '#666' }}>
          {model || '—'}
        </td>
        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px' }}>
          {inputTokens ? formatTokenCount(Number(inputTokens)) : '—'}
        </td>
        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px' }}>
          {outputTokens ? formatTokenCount(Number(outputTokens)) : '—'}
        </td>
        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
          {span.duration_ms != null ? formatDuration(span.duration_ms) : '—'}
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
        <td style={{ padding: '8px 12px', color: '#888', whiteSpace: 'nowrap', fontSize: '12px' }}>
          {new Date(span.start_time).toLocaleString()}
        </td>
      </tr>
      {expanded && hasGenAI && (
        <tr style={{ borderBottom: '1px solid #eee' }}>
          <td colSpan={7} style={{ padding: '0 12px 12px 36px' }}>
            <div
              style={{
                background: 'var(--bg-cream)',
                border: '2px solid var(--border-color)',
                padding: '12px 16px',
              }}
            >
              {/* gen_ai attributes grid */}
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', color: '#888', letterSpacing: '0.5px' }}>
                Gen AI Attributes
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px' }}>
                {Object.entries(genAI).map(([key, value]) => (
                  <div key={key} style={{ fontSize: '12px' }}>
                    <span style={{ color: '#888', fontWeight: 600 }}>{formatAttrKey(key)}:</span>{' '}
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--dark)' }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Trace context */}
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', fontSize: '11px', color: '#888', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span><strong>trace:</strong> <code style={{ fontSize: '10px' }}>{span.trace_id}</code></span>
                <span><strong>span:</strong> <code style={{ fontSize: '10px' }}>{span.span_id}</code></span>
                {span.parent_span_id && <span><strong>parent:</strong> <code style={{ fontSize: '10px' }}>{span.parent_span_id}</code></span>}
                <span><strong>kind:</strong> {span.span_kind || '—'}</span>
                {span.service_name && <span><strong>service:</strong> {span.service_name}</span>}
              </div>

              {/* Status message if error */}
              {span.status_code === 'ERROR' && span.status_message && (
                <div style={{ marginTop: '8px', padding: '8px', background: '#fde8e8', border: '1px solid #c0392b', fontSize: '12px', fontFamily: 'monospace', color: '#c0392b' }}>
                  {span.status_message}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── LLM-focused detail view ─────────────────────────────────────────────

function LLMProfileDetail({
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
  const hourlyTokens = llmData?.hourlyTokens || [];
  const modelLatency = llmData?.modelLatency || [];
  const topOperations = llmData?.topOperations || [];
  const totals = llmData?.totals || { totalInputTokens: 0, totalOutputTokens: 0, distinctModels: 0, avgDurationMs: 0, avgTokensPerSec: 0 };
  const errorRate = profile.total_spans > 0 ? ((profile.total_errors / profile.total_spans) * 100).toFixed(1) : '0.0';
  const maxDailyRequests = Math.max(1, ...dailyUsage.map((d) => d.request_count));
  const maxHourlyTokens = Math.max(1, ...hourlyTokens.map((h) => Number(h.input_tokens) + Number(h.output_tokens)));
  const maxBucketCount = Math.max(1, ...buckets.map((b) => b.span_count));

  return (
    <div>
      {/* Back link */}
      <Link to="/tools" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: 'var(--dark)', fontWeight: 700, textDecoration: 'none' }}>
        <ArrowLeft size={20} /> Back to Tools
      </Link>

      {/* LLM Header */}
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

      {/* Stats row - 6 cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', marginBottom: '32px' }}>
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
          <TrendingUp size={20} style={{ color: '#06b6d4', marginBottom: '8px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{totals.avgTokensPerSec > 0 ? `${totals.avgTokensPerSec}` : '—'}</div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Tokens/sec</div>
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
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{formatDuration(latency?.avg || totals.avgDurationMs || 0)}</div>
          <div style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Avg Latency</div>
        </div>
      </div>

      {/* Two-column: Daily requests + Hourly token throughput */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* Daily requests chart */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
            <Gauge size={16} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
            Request Volume (30 days)
          </h3>
          {dailyUsage.length > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '140px' }}>
                {dailyUsage.map((day, i) => {
                  const height = Math.max(4, (day.request_count / maxDailyRequests) * 100);
                  const errorRatio = day.request_count > 0 ? day.error_count / day.request_count : 0;
                  return (
                    <div
                      key={i}
                      title={`${new Date(day.day).toLocaleDateString()}: ${day.request_count} requests, ${day.error_count} errors`}
                      style={{
                        flex: 1,
                        height: `${height}%`,
                        background: errorRatio > 0.1 ? '#c0392b' : 'linear-gradient(to top, #8b5cf6, #a78bfa)',
                        border: '1px solid var(--border-color)',
                        minWidth: '4px',
                        borderRadius: '2px 2px 0 0',
                        transition: 'height 0.3s ease',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', marginTop: '4px' }}>
                <span>{dailyUsage.length > 0 ? new Date(dailyUsage[0].day).toLocaleDateString() : ''}</span>
                <span>{dailyUsage.length > 0 ? new Date(dailyUsage[dailyUsage.length - 1].day).toLocaleDateString() : ''}</span>
              </div>
            </div>
          ) : (
            <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              No daily data yet
            </div>
          )}
        </div>

        {/* Hourly token throughput */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
            <TrendingUp size={16} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
            Token Throughput (24h)
          </h3>
          {hourlyTokens.length > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '140px' }}>
                {hourlyTokens.map((h, i) => {
                  const total = Number(h.input_tokens) + Number(h.output_tokens);
                  const height = Math.max(4, (total / maxHourlyTokens) * 100);
                  const inputPct = total > 0 ? (Number(h.input_tokens) / total) * 100 : 50;
                  return (
                    <div
                      key={i}
                      title={`${new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${formatTokenCount(Number(h.input_tokens))} in, ${formatTokenCount(Number(h.output_tokens))} out`}
                      style={{
                        flex: 1,
                        height: `${height}%`,
                        background: `linear-gradient(to top, #3b82f6 0%, #3b82f6 ${inputPct}%, #8b5cf6 ${inputPct}%, #8b5cf6 100%)`,
                        border: '1px solid var(--border-color)',
                        minWidth: '4px',
                        borderRadius: '2px 2px 0 0',
                        transition: 'height 0.3s ease',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '11px', marginTop: '8px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', background: '#3b82f6', border: '1px solid var(--border-color)', display: 'inline-block' }} />
                  Input
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', background: '#8b5cf6', border: '1px solid var(--border-color)', display: 'inline-block' }} />
                  Output
                </span>
              </div>
            </div>
          ) : (
            <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              No hourly data yet
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Daily token usage + Activity timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* Daily token usage (stacked) */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
            <Hash size={16} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
            Daily Token Consumption (30 days)
          </h3>
          {dailyUsage.length > 0 ? (() => {
            const maxTokens = Math.max(1, ...dailyUsage.map((d) => Number(d.input_tokens) + Number(d.output_tokens)));
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '140px' }}>
                  {dailyUsage.map((day, i) => {
                    const total = Number(day.input_tokens) + Number(day.output_tokens);
                    const height = Math.max(4, (total / maxTokens) * 100);
                    const inputPct = total > 0 ? (Number(day.input_tokens) / total) * 100 : 50;
                    return (
                      <div
                        key={i}
                        title={`${new Date(day.day).toLocaleDateString()}: ${formatTokenCount(Number(day.input_tokens))} in, ${formatTokenCount(Number(day.output_tokens))} out`}
                        style={{
                          flex: 1,
                          height: `${height}%`,
                          background: `linear-gradient(to top, #3b82f6 0%, #3b82f6 ${inputPct}%, #8b5cf6 ${inputPct}%, #8b5cf6 100%)`,
                          border: '1px solid var(--border-color)',
                          minWidth: '4px',
                          borderRadius: '2px 2px 0 0',
                          transition: 'height 0.3s ease',
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '11px', marginTop: '8px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '10px', height: '10px', background: '#3b82f6', border: '1px solid var(--border-color)', display: 'inline-block' }} />
                    Input
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '10px', height: '10px', background: '#8b5cf6', border: '1px solid var(--border-color)', display: 'inline-block' }} />
                    Output
                  </span>
                </div>
              </div>
            );
          })() : (
            <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              No token data yet
            </div>
          )}
        </div>

        {/* Activity timeline (24h) */}
        <div className="card">
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
            <Activity size={16} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
            Request Activity (24h)
          </h3>
          {buckets.length > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '140px' }}>
                {buckets.map((bucket, i) => {
                  const height = Math.max(4, (bucket.span_count / maxBucketCount) * 100);
                  const errorRatio = bucket.span_count > 0 ? bucket.error_count / bucket.span_count : 0;
                  return (
                    <div
                      key={i}
                      title={`${new Date(bucket.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${bucket.span_count} spans, ${bucket.error_count} errors, avg ${bucket.avg_latency_ms}ms`}
                      style={{
                        flex: 1,
                        height: `${height}%`,
                        background: errorRatio > 0.1 ? '#c0392b' : 'var(--dark)',
                        border: '1px solid var(--border-color)',
                        minWidth: '4px',
                        borderRadius: '2px 2px 0 0',
                        transition: 'height 0.3s ease',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', marginTop: '4px' }}>
                <span>{buckets.length > 0 ? new Date(buckets[0].hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                <span>{buckets.length > 0 ? new Date(buckets[buckets.length - 1].hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            </div>
          ) : (
            <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              No activity data yet
            </div>
          )}
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
                      {model.avg_latency_ms != null ? formatDuration(model.avg_latency_ms) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      {formatTokenCount(Number(model.total_input_tokens))}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      {formatTokenCount(Number(model.total_output_tokens))}
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

      {/* Two-column: Per-model latency + Top operations */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* Per-model latency percentiles */}
        {modelLatency.length > 0 && (
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
              <Clock size={16} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
              Latency by Model
            </h3>
            {modelLatency.map((m) => {
              const maxVal = Math.max(m.p99, 1);
              return (
                <div key={m.model} style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', marginBottom: '6px' }}>{m.model}</div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px' }}>
                    <div style={{ flex: 1 }}>
                      {(['p50', 'p95', 'p99'] as const).map((key) => {
                        const val = m[key];
                        const pct = Math.max(2, (val / maxVal) * 100);
                        const colors = { p50: '#a78bfa', p95: '#8b5cf6', p99: '#c0392b' };
                        return (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                            <span style={{ width: '24px', fontWeight: 600, textTransform: 'uppercase', color: '#888' }}>{key}</span>
                            <div style={{ flex: 1, height: '8px', background: 'var(--bg-cream)', border: '1px solid var(--border-color)' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: colors[key], transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ width: '60px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatDuration(val)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                    min {formatDuration(m.min_ms)} / avg {formatDuration(m.avg_ms)} / max {formatDuration(m.max_ms)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Top operations */}
        {topOperations.length > 0 && (
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
              <Layers size={16} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
              Top Span Operations
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Operation</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Calls</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Avg</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Tokens</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Err</th>
                  </tr>
                </thead>
                <tbody>
                  {topOperations.map((op) => (
                    <tr key={op.span_name} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {op.span_name}
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{op.call_count.toLocaleString()}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{op.avg_latency_ms ? formatDuration(op.avg_latency_ms) : '—'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                        {formatTokenCount(Number(op.total_input_tokens) + Number(op.total_output_tokens))}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, padding: '1px 4px',
                          background: op.error_count > 0 ? '#fde8e8' : '#e8fde8',
                          color: op.error_count > 0 ? '#c0392b' : '#27ae60',
                          border: '1px solid currentColor',
                        }}>
                          {op.error_count}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Global Latency Distribution */}
      {latency && latency.p99 > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Global Latency Distribution</h3>
          {(['p50', 'p95', 'p99'] as const).map((key) => {
            const value = latency[key];
            const pct = latency.p99 > 0 ? Math.max(2, (value / latency.p99) * 100) : 0;
            return (
              <div key={key} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                  <span style={{ textTransform: 'uppercase' }}>{key}</span>
                  <span>{formatDuration(value)}</span>
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

      {/* Recent LLM Traces - expanded with gen_ai attributes */}
      <div className="card">
        <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>
          <Brain size={18} style={{ verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
          Recent LLM Traces
        </h3>
        {spans.length === 0 ? (
          <p style={{ color: '#888' }}>No spans recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '3px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Name</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Model</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>In Tokens</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Out Tokens</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Duration</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {spans.map((span) => (
                  <SpanRow key={span.id} span={span} />
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
      const res = await fetch(`${API_BASE}/v1/tool-profiles/${profileId}/spans?limit=25`, {
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
