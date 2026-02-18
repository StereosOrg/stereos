import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Cloud, CheckCircle, AlertCircle, Copy, Check, ChevronDown } from 'lucide-react';

const DEFAULT_OTEL_URL = `${API_BASE}/v1/traces`;

const OPENAI_LOGO = 'https://images.seeklogo.com/logo-png/42/2/open-ai-logo-png_seeklogo-428036.png';
const ANTHROPIC_LOGO = 'https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/1/anthropic-icon-wii9u8ifrjrd99btrqfgi.png/anthropic-icon-tdvkiqisswbrmtkiygb0ia.png';

interface GatewayData {
  cf_gateway_id: string | null;
  cf_account_id: string | null;
  proxy_url: string | null;
  inference_url: string | null;
}

const cardStyle: React.CSSProperties = {
  padding: '24px',
  border: '1px solid var(--border-default)',
  borderRadius: '12px',
  background: 'var(--bg-white)',
};

const inlineSelectStyle: React.CSSProperties = {
  padding: '6px 28px 6px 12px',
  fontSize: '14px',
  fontWeight: 600,
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  background: 'var(--bg-white)',
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
};

type Provider = 'openai' | 'anthropic';
type SdkType = 'vercel' | 'js' | 'python' | 'curl';

function buildSnippet(
  provider: Provider,
  sdk: SdkType,
  baseUrl: string,
): string {
  const proxyUrl = baseUrl;

  const model = provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-5-20250929';
  const virtualKeyPlaceholder = '{your_virtual_key}';
  const apiKeyPlaceholder = virtualKeyPlaceholder;

  if (sdk === 'vercel') {
    return `import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const stereos = createOpenAICompatible({
  baseURL: "${proxyUrl}",
  apiKey: "${apiKeyPlaceholder}",
});

const { text } = await generateText({
  model: stereos("${model}"),
  prompt: "Hello, world!",
});

console.log(text);`;
  }

  if (sdk === 'js') {
    return `const response = await fetch("${proxyUrl}/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiKeyPlaceholder}",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "Hello, world!" }],
  }),
});

const data = await response.json();
console.log(data.choices?.[0]?.message?.content);`;
  }

  if (sdk === 'python') {
    return `import requests

response = requests.post(
    "${proxyUrl}/chat/completions",
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer ${apiKeyPlaceholder}",
    },
    json={
        "model": "${model}",
        "messages": [{"role": "user", "content": "Hello, world!"}],
    },
)

data = response.json()
print(data.get("choices", [{}])[0].get("message", {}).get("content"))`;
  }

  // curl
  return `curl ${proxyUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
  "model": "${model}",
  "messages": [
    { "role": "user", "content": "Hello, world!" }
  ]
}'`;
}

export function AIGateway() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [otelUrl, setOtelUrl] = useState(DEFAULT_OTEL_URL);
  const [otelMessage, setOtelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [provider, setProvider] = useState<Provider>('openai');
  const [sdk, setSdk] = useState<SdkType>('vercel');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const { data, isLoading } = useQuery<GatewayData>({
    queryKey: ['ai-gateway'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/gateway`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch gateway info');
      return res.json();
    },
  });

  const provision = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/gateway/provision`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to provision gateway');
      }
      return res.json();
    },
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['ai-gateway'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateOtel = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`${API_BASE}/v1/ai/gateway/otel`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ otel_url: url }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to update OTEL endpoint');
      }
      return res.json();
    },
    onSuccess: () => {
      setOtelMessage({ type: 'success', text: 'OTEL endpoint updated' });
      setTimeout(() => setOtelMessage(null), 3000);
    },
    onError: (err: Error) => {
      setOtelMessage({ type: 'error', text: err.message });
    },
  });

  const isProvisioned = !!data?.cf_gateway_id;

  const copyUrl = () => {
    const url = data?.proxy_url || data?.inference_url;
    if (url) {
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '48px' }}>
        <p style={{ color: '#666' }}>Loading...</p>
      </div>
    );
  }

  const proxyUrl = data?.proxy_url || data?.inference_url || `${API_BASE}/v1`;
  const snippet = isProvisioned
    ? buildSnippet(provider, sdk, proxyUrl)
    : '';

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <h1 className="heading-1">AI Gateway</h1>
        <p className="text-large">
          Route AI requests through your gateway with rate limiting, caching, and full observability.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px' }}>
        {/* Gateway Status */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <Cloud size={24} />
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Gateway Status</h2>
          </div>

          {isProvisioned ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#16a34a', marginBottom: '20px' }}>
                <CheckCircle size={18} />
                <span style={{ fontWeight: 600, fontSize: '14px' }}>Provisioned</span>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>
                  Gateway ID
                </label>
                <div style={{ padding: '10px 14px', background: 'var(--bg-cream)', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}>
                  {data.cf_gateway_id}
                </div>
              </div>

              {(data.proxy_url || data.inference_url) && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>
                    Proxy endpoint
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'var(--bg-cream)', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    <span style={{ flex: 1 }}>{data.proxy_url || data.inference_url}</span>
                    <button type="button" onClick={copyUrl} title="Copy URL" style={{ flexShrink: 0, padding: '4px', background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#16a34a' : '#666' }}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
                No gateway provisioned yet. Click below to create one.
              </p>
              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', fontSize: '13px', marginBottom: '12px' }}>
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={() => provision.mutate()}
                disabled={provision.isPending}
                style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 700, color: 'white', background: 'var(--dark)', border: 'none', borderRadius: '8px', cursor: provision.isPending ? 'not-allowed' : 'pointer', opacity: provision.isPending ? 0.6 : 1 }}
              >
                {provision.isPending ? 'Provisioning...' : 'Provision Gateway'}
              </button>
            </div>
          )}
        </div>

        {/* Observability */}
        {isProvisioned && (
          <div style={cardStyle}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, marginBottom: '8px' }}>Observability</h2>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
              Configure where your gateway sends OpenTelemetry traces.
            </p>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>
              OTEL endpoint URL
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="url"
                value={otelUrl}
                onChange={(e) => setOtelUrl(e.target.value)}
                placeholder={DEFAULT_OTEL_URL}
                style={{ flex: 1, padding: '10px 14px', fontSize: '13px', fontFamily: 'monospace', border: '1px solid var(--border-default)', borderRadius: '8px', background: 'var(--bg-cream)' }}
              />
              <button
                type="button"
                onClick={() => updateOtel.mutate(otelUrl)}
                disabled={updateOtel.isPending || !otelUrl.trim()}
                style={{ padding: '10px 16px', fontSize: '13px', fontWeight: 700, color: 'white', background: 'var(--dark)', border: 'none', borderRadius: '8px', cursor: updateOtel.isPending ? 'not-allowed' : 'pointer', opacity: updateOtel.isPending ? 0.6 : 1, whiteSpace: 'nowrap' }}
              >
                {updateOtel.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>

            {otelMessage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', fontSize: '13px', color: otelMessage.type === 'success' ? '#16a34a' : '#dc2626' }}>
                {otelMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {otelMessage.text}
              </div>
            )}
          </div>
        )}

        {/* Example Requests - spans full width */}
        {isProvisioned && (
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            {/* Inline selector row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600 }}>Make a request to</span>

              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <img
                  src={provider === 'openai' ? OPENAI_LOGO : ANTHROPIC_LOGO}
                  alt=""
                  style={{ position: 'absolute', left: '10px', width: '16px', height: '16px', borderRadius: '3px', objectFit: 'contain', pointerEvents: 'none' }}
                />
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  style={{ ...inlineSelectStyle, paddingLeft: '32px' }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '8px', pointerEvents: 'none', color: '#666' }} />
              </div>

              <span style={{ fontSize: '15px', fontWeight: 600 }}>using</span>

              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <select
                  value={sdk}
                  onChange={(e) => setSdk(e.target.value as SdkType)}
                  style={inlineSelectStyle}
                >
                  <option value="vercel">Vercel AI SDK</option>
                  <option value="js">OpenAI-compatible JS SDK</option>
                  <option value="python">OpenAI-compatible Python SDK</option>
                  <option value="curl">cURL</option>
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '8px', pointerEvents: 'none', color: '#666' }} />
              </div>
            </div>
            <p style={{ margin: '-6px 0 16px', fontSize: '13px', color: '#666' }}>
              Use your virtual key as the SDK `apiKey` (or `Authorization: Bearer`). Provider keys are not required when Unified Billing is enabled.
            </p>

            {/* Code block */}
            <div style={{ position: 'relative' }}>
              <pre
                style={{
                  background: '#1a1a2e',
                  color: '#e0e0e0',
                  padding: '24px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  lineHeight: 1.7,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {snippet}
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(snippet);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                }}
                title="Copy snippet"
                style={{ position: 'absolute', top: '12px', right: '12px', padding: '6px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: copiedSnippet ? '#16a34a' : '#999' }}
              >
                {copiedSnippet ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
