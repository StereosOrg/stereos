/**
 * OpenRouter Management API client.
 * Used to provision API keys for users/teams. Keys are used with OpenRouter for LLM access.
 * @see https://openrouter.ai/docs/api/api-reference/api-keys/create-keys
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export type OpenRouterCreateKeyParams = {
  name: string;
  limit?: number | null;
  limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
  include_byok_in_limit?: boolean;
  expires_at?: string | null; // ISO 8601
};

export type OpenRouterKeyResponse = {
  data: {
    hash: string;
    name: string;
    label: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    include_byok_in_limit: boolean;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    byok_usage: number;
    byok_usage_daily: number;
    byok_usage_weekly: number;
    byok_usage_monthly: number;
    created_at: string;
    updated_at: string | null;
    expires_at: string | null;
  };
  key?: string; // Raw key, only in create response
};

export async function createOpenRouterKey(
  managementKey: string,
  params: OpenRouterCreateKeyParams
): Promise<OpenRouterKeyResponse> {
  const res = await fetch(`${OPENROUTER_BASE}/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managementKey}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter create key failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<OpenRouterKeyResponse>;
}

export async function getOpenRouterKey(
  managementKey: string,
  hash: string
): Promise<{ data: OpenRouterKeyResponse['data'] }> {
  const res = await fetch(`${OPENROUTER_BASE}/keys/${encodeURIComponent(hash)}`, {
    headers: { Authorization: `Bearer ${managementKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter get key failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{ data: OpenRouterKeyResponse['data'] }>;
}

export async function deleteOpenRouterKey(
  managementKey: string,
  hash: string
): Promise<{ deleted: true }> {
  const res = await fetch(`${OPENROUTER_BASE}/keys/${encodeURIComponent(hash)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${managementKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter delete key failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{ deleted: true }>;
}

// ── Guardrails ─────────────────────────────────────────────────────────────
// @see https://openrouter.ai/docs/api/api-reference/guardrails/

export type Guardrail = {
  id: string;
  name: string;
  description: string | null;
  limit_usd: number | null;
  reset_interval: 'daily' | 'weekly' | 'monthly' | null;
  allowed_providers: string[] | null;
  allowed_models: string[] | null;
  enforce_zdr: boolean | null;
  created_at: string;
  updated_at: string | null;
};

export type GuardrailKeyAssignment = {
  id: string;
  key_hash: string;
  guardrail_id: string;
  key_name: string;
  key_label: string;
  assigned_by: string | null;
  created_at: string;
};

export async function listGuardrails(
  managementKey: string,
  params?: { offset?: number; limit?: number }
): Promise<{ data: Guardrail[]; total_count: number }> {
  const search = new URLSearchParams();
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.limit != null) search.set('limit', String(params.limit));
  const qs = search.toString();
  const url = `${OPENROUTER_BASE}/guardrails${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${managementKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter list guardrails failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ data: Guardrail[]; total_count: number }>;
}

export async function deleteGuardrail(
  managementKey: string,
  guardrailId: string
): Promise<{ deleted: boolean }> {
  const res = await fetch(`${OPENROUTER_BASE}/guardrails/${encodeURIComponent(guardrailId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${managementKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter delete guardrail failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ deleted: boolean }>;
}

export async function createGuardrail(
  managementKey: string,
  params: {
    name: string;
    description?: string | null;
    limit_usd?: number | null;
    reset_interval?: 'daily' | 'weekly' | 'monthly' | null;
    allowed_providers?: string[] | null;
    allowed_models?: string[] | null;
    enforce_zdr?: boolean | null;
  }
): Promise<{ data: Guardrail }> {
  const res = await fetch(`${OPENROUTER_BASE}/guardrails`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managementKey}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter create guardrail failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ data: Guardrail }>;
}

export async function bulkAssignKeysToGuardrail(
  managementKey: string,
  guardrailId: string,
  keyHashes: string[]
): Promise<{ assigned_count: number }> {
  const res = await fetch(`${OPENROUTER_BASE}/guardrails/${encodeURIComponent(guardrailId)}/assignments/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managementKey}`,
    },
    body: JSON.stringify({ key_hashes: keyHashes }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter assign keys to guardrail failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ assigned_count: number }>;
}

export async function bulkUnassignKeysFromGuardrail(
  managementKey: string,
  guardrailId: string,
  keyHashes: string[]
): Promise<{ unassigned_count: number }> {
  const res = await fetch(`${OPENROUTER_BASE}/guardrails/${encodeURIComponent(guardrailId)}/assignments/keys/remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managementKey}`,
    },
    body: JSON.stringify({ key_hashes: keyHashes }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter unassign keys from guardrail failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ unassigned_count: number }>;
}

export async function listGuardrailKeyAssignments(
  managementKey: string,
  guardrailId: string,
  params?: { offset?: number; limit?: number }
): Promise<{ data: GuardrailKeyAssignment[]; total_count: number }> {
  const search = new URLSearchParams();
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.limit != null) search.set('limit', String(params.limit));
  const qs = search.toString();
  const url = `${OPENROUTER_BASE}/guardrails/${encodeURIComponent(guardrailId)}/assignments/keys${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${managementKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter list guardrail key assignments failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ data: GuardrailKeyAssignment[]; total_count: number }>;
}
