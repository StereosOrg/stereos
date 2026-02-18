/**
 * Cloudflare AI Gateway API client.
 * Used to provision per-customer gateways and list available models.
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CfGatewayCreateParams = {
  id: string;
  collect_logs?: boolean;
  rate_limiting_limit?: number;
  rate_limiting_interval?: number;
  cache_ttl?: number;
  logpush?: boolean;
  logpush_public_key?: string;
};

export type CfGatewayDlp = {
  enabled: boolean;
  action: string;
  profiles: string[];
};

export type CfGatewayResponse = {
  id: string;
  collect_logs: boolean;
  rate_limiting_limit: number;
  rate_limiting_interval: number;
  created_at: string;
  dlp?: CfGatewayDlp;
};

export type CfModel = {
  id: string;
  name: string;
  description: string;
  task: { id: string; name: string; description: string };
};

export async function createCfGateway(
  accountId: string,
  apiToken: string,
  params: CfGatewayCreateParams
): Promise<CfGatewayResponse> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        ...params,
        collect_logs: false,
        rate_limiting_limit: 0,
        rate_limiting_interval: 0,
        rate_limiting_technique: 'fixed',
        cache_ttl: 0,
        cache_invalidate_on_update: true,
        authentication: true,
        zdr: true,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway create failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { result: CfGatewayResponse };
  return json.result;
}

export async function getCfGateway(
  accountId: string,
  apiToken: string,
  gatewayId: string
): Promise<CfGatewayResponse> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway get failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { result: CfGatewayResponse };
  return json.result;
}

export type CfGatewayUpdateParams = {
  logpush?: boolean;
  logpush_public_key?: string;
  otel?: Array<{
    authorization?: string;
    headers?: Record<string, string>;
    url: string;
  }>;
  dlp?: {
    enabled: boolean;
    action: 'BLOCK' | 'FLAG';
    profiles: string[];
  };
};

export async function updateCfGateway(
  accountId: string,
  apiToken: string,
  gatewayId: string,
  params: CfGatewayUpdateParams
): Promise<CfGatewayResponse> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        collect_logs: false,
        rate_limiting_limit: 0,
        rate_limiting_interval: 0,
        rate_limiting_technique: 'fixed',
        cache_ttl: 0,
        cache_invalidate_on_update: true,
        authentication: true,
        zdr: true,
        ...params,
        // Ensure otel entries have all required fields
        otel: params.otel?.map((o) => ({
          ...o,
          authorization: o.authorization ?? '',
          headers: o.headers ?? {},
        })),
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway update failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { result: CfGatewayResponse };
  return json.result;
}

export async function deleteCfGateway(
  accountId: string,
  apiToken: string,
  gatewayId: string
): Promise<void> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway delete failed: ${res.status} ${text}`);
  }
}

export async function listCfModels(
  accountId: string,
  apiToken: string
): Promise<CfModel[]> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai/models/search`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI models list failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { result: CfModel[] };
  return json.result;
}

// Provider key configuration for BYOK (Bring Your Own Keys)
export type CfProviderKeys = {
  openai?: { token: string };
  anthropic?: { token: string };
  azure?: { token: string; resource_name?: string };
  google?: { token: string };
  groq?: { token: string };
  cerebras?: { token: string };
  mistral?: { token: string };
  cohere?: { token: string };
  // Add more providers as needed
};

export async function updateCfProviderKeys(
  accountId: string,
  apiToken: string,
  gatewayId: string,
  providerKeys: CfProviderKeys
): Promise<void> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        collect_logs: false,
        rate_limiting_limit: 0,
        rate_limiting_interval: 0,
        rate_limiting_technique: 'fixed',
        cache_ttl: 0,
        cache_invalidate_on_update: true,
        authentication: true,
        zdr: true,
        providers: providerKeys,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF AI Gateway provider keys update failed: ${res.status} ${text}`);
  }
}
