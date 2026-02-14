/**
 * Vendor canonicalization for OTLP telemetry.
 * Maps OTEL resource attributes to canonical vendor slugs.
 */

export interface VendorDefinition {
  slug: string;
  displayName: string;
  category: string;
  matcher: (attrs: Record<string, string>) => boolean;
}

const VENDOR_REGISTRY: VendorDefinition[] = [
  {
    slug: 'cloudflare-workers',
    displayName: 'Cloudflare Workers',
    category: 'runtime',
    matcher: (attrs) => {
      if (attrs['cloud.provider'] === 'cloudflare') return true;
      const svc = (attrs['service.name'] || '').toLowerCase();
      if (/cloudflare|workers/.test(svc)) return true;
      if (attrs['faas.trigger']) return true;
      return false;
    },
  },
  {
    slug: 'arcade',
    displayName: 'Arcade Dev',
    category: 'tool-server',
    matcher: (attrs) => {
      const svc = (attrs['service.name'] || '').toLowerCase();
      const sdk = (attrs['sdk.name'] || '').toLowerCase();
      return svc.includes('arcade') || sdk.includes('arcade');
    },
  },
  {
    slug: 'vscode',
    displayName: 'VS Code',
    category: 'ide',
    matcher: (attrs) => {
      const exe = (attrs['process.executable.name'] || '').toLowerCase();
      const cmd = (attrs['process.command'] || '').toLowerCase();
      return exe === 'code' || cmd.includes('code');
    },
  },
  {
    slug: 'cursor',
    displayName: 'Cursor',
    category: 'ide',
    matcher: (attrs) => {
      const svc = (attrs['service.name'] || '').toLowerCase();
      const exe = (attrs['process.executable.name'] || '').toLowerCase();
      return svc.includes('cursor') || exe.includes('cursor');
    },
  },
  {
    slug: 'e2b',
    displayName: 'E2B Sandbox',
    category: 'sandbox',
    matcher: (attrs) => {
      const svc = (attrs['service.name'] || '').toLowerCase();
      return svc.includes('e2b');
    },
  },
  {
    slug: 'anthropic',
    displayName: 'Anthropic (Claude)',
    category: 'llm',
    matcher: (attrs) => {
      const genAiSystem = (attrs['gen_ai.system'] || '').toLowerCase();
      if (genAiSystem === 'anthropic' || genAiSystem === 'claude') return true;
      const svc = (attrs['service.name'] || '').toLowerCase();
      if (svc.includes('anthropic') || svc.includes('claude')) return true;
      const model = (attrs['gen_ai.request.model'] || '').toLowerCase();
      if (model.includes('claude')) return true;
      return false;
    },
  },
  {
    slug: 'google-gemini',
    displayName: 'Google (Gemini)',
    category: 'llm',
    matcher: (attrs) => {
      const genAiSystem = (attrs['gen_ai.system'] || '').toLowerCase();
      if (genAiSystem === 'gemini' || genAiSystem === 'google') return true;
      const svc = (attrs['service.name'] || '').toLowerCase();
      if (svc.includes('gemini')) return true;
      const model = (attrs['gen_ai.request.model'] || '').toLowerCase();
      if (model.includes('gemini')) return true;
      return false;
    },
  },
  {
    slug: 'openai',
    displayName: 'OpenAI',
    category: 'llm',
    matcher: (attrs) => {
      const genAiSystem = (attrs['gen_ai.system'] || '').toLowerCase();
      if (genAiSystem === 'openai') return true;
      const svc = (attrs['service.name'] || '').toLowerCase();
      const sdk = (attrs['sdk.name'] || '').toLowerCase();
      const exe = (attrs['process.executable.name'] || '').toLowerCase();
      if (svc.includes('openai')) return true;
      if (svc === 'codex' || sdk.includes('codex') || exe.includes('codex')) return true;
      const model = (attrs['gen_ai.request.model'] || '').toLowerCase();
      if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return true;
      return false;
    },
  },
  {
    slug: 'kilo-code',
    displayName: 'Kilo Code',
    category: 'llm',
    matcher: (attrs) => {
      const svc = (attrs['service.name'] || '').toLowerCase();
      const sdk = (attrs['sdk.name'] || '').toLowerCase();
      return svc.includes('kilo') || sdk.includes('kilo');
    },
  },
  {
    slug: 'openrouter',
    displayName: 'OpenRouter',
    category: 'llm',
    matcher: (attrs) => {
      const genAiSystem = (attrs['gen_ai.system'] || '').toLowerCase();
      const svc = (attrs['service.name'] || '').toLowerCase();
      return genAiSystem === 'openrouter' || svc.includes('openrouter');
    },
  },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface CanonicalVendor {
  slug: string;
  displayName: string;
  category: string;
}

/**
 * Determine canonical vendor from flattened OTEL resource attributes.
 * Falls back to slugified service.name if no matcher hits.
 */
export function canonicalizeVendor(attrs: Record<string, string>): CanonicalVendor {
  for (const vendor of VENDOR_REGISTRY) {
    if (vendor.matcher(attrs)) {
      return { slug: vendor.slug, displayName: vendor.displayName, category: vendor.category };
    }
  }

  const serviceName = attrs['service.name'] || 'unknown';
  const slug = slugify(serviceName);
  return {
    slug: slug || 'unknown',
    displayName: serviceName,
    category: 'unknown',
  };
}

export function isLLMTool(attrs: Record<string, string>, vendor?: CanonicalVendor): boolean {
  if (vendor?.category === 'llm') return true;
  const genAiSystem = (attrs['gen_ai.system'] || '').toLowerCase();
  if (genAiSystem) return true;
  const reqModel = (attrs['gen_ai.request.model'] || '').toLowerCase();
  const respModel = (attrs['gen_ai.response.model'] || '').toLowerCase();
  return Boolean(reqModel || respModel);
}

/**
 * Convert OTEL's [{key, value: {stringValue, intValue, ...}}] format
 * to a plain Record<string, string>.
 */
export function flattenOtelAttributes(attrs: Array<{ key: string; value?: { stringValue?: string; intValue?: string | number; boolValue?: boolean; doubleValue?: number; arrayValue?: unknown } }> | undefined): Record<string, string> {
  if (!attrs || !Array.isArray(attrs)) return {};
  const result: Record<string, string> = {};
  for (const attr of attrs) {
    const v = attr.value;
    if (!v) continue;
    if (v.stringValue !== undefined) result[attr.key] = v.stringValue;
    else if (v.intValue !== undefined) result[attr.key] = String(v.intValue);
    else if (v.boolValue !== undefined) result[attr.key] = String(v.boolValue);
    else if (v.doubleValue !== undefined) result[attr.key] = String(v.doubleValue);
  }
  return result;
}
