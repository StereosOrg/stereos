import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '@stereos/shared/db';
import * as schema from '@stereos/shared/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, getCurrentUser } from '../lib/middleware.js';
import type { AppVariables } from '../types/app.js';

const router = new Hono<{ Variables: AppVariables }>();

const requireAdmin = async (c: any, next: any) => {
  const user = c.get('user');
  const role = user?.role;
  if (!user || role !== 'admin') {
    return c.json({ error: 'Forbidden - Admin access required' }, 403);
  }
  await next();
};

// Cast middleware to avoid type issues
const authMiddleware = requireAuth as any;

// Provider key schema - each provider can have a key and enabled flag
const providerConfigSchema = z.object({
  key: z.string(),
  enabled: z.boolean().default(true),
  endpoint: z.string().optional(),
});

const providerKeySchema = z.record(providerConfigSchema);

// Simple XOR encryption for provider keys (basic obfuscation)
function encryptKey(key: string): string {
  if (!key || key.startsWith('••••')) return key;
  const xorKey = process.env.PROVIDER_KEY_ENCRYPTION_SECRET || 'default-secret-change-me';
  let result = '';
  for (let i = 0; i < key.length; i++) {
    result += String.fromCharCode(key.charCodeAt(i) ^ xorKey.charCodeAt(i % xorKey.length));
  }
  return Buffer.from(result).toString('base64');
}

function decryptKey(encrypted: string): string {
  const xorKey = process.env.PROVIDER_KEY_ENCRYPTION_SECRET || 'default-secret-change-me';
  const buffer = Buffer.from(encrypted, 'base64');
  let result = '';
  for (let i = 0; i < buffer.length; i++) {
    result += String.fromCharCode(buffer[i] ^ xorKey.charCodeAt(i % xorKey.length));
  }
  return result;
}

// Helper to get customer for user
async function getCustomerForUser(dbInstance: any, userId: string) {
  const user = await dbInstance.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { customer_id: true },
  });
  
  if (!user?.customer_id) return null;
  
  return dbInstance.query.customers.findFirst({
    where: eq(schema.customers.id, user.customer_id),
  });
}

// GET /v1/provider-keys - Get provider keys (admin only, returns masked keys)
router.get('/provider-keys', authMiddleware, requireAdmin, async (c) => {
  const dbInstance = c.get('db');
  const user = c.get('user');
  if (!user?.id) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const customer = await getCustomerForUser(dbInstance, user.id);

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404);
  }

  try {
    const providerKeys = (customer.provider_keys || {}) as Record<string, { key: string; enabled: boolean; endpoint?: string }>;

    // Mask the keys for display (show only last 4 characters)
    const maskedKeys = Object.entries(providerKeys).reduce((acc, [provider, config]) => {
      if (config.key && !config.key.startsWith('••••')) {
        try {
          const decrypted = decryptKey(config.key);
          acc[provider] = {
            enabled: config.enabled,
            endpoint: config.endpoint,
            hasKey: true,
            masked: decrypted.length > 4 ? `••••${decrypted.slice(-4)}` : '••••',
          };
        } catch {
          acc[provider] = { enabled: config.enabled, endpoint: config.endpoint, hasKey: true, masked: '••••' };
        }
      } else {
        acc[provider] = { enabled: config.enabled, endpoint: config.endpoint, hasKey: false, masked: null };
      }
      return acc;
    }, {} as Record<string, any>);

    return c.json({ provider_keys: maskedKeys });
  } catch (error) {
    console.error('Error fetching provider keys:', error);
    return c.json({ error: 'Failed to fetch provider keys' }, 500);
  }
});

// POST /v1/provider-keys - Update provider keys (admin only)
router.post('/provider-keys', authMiddleware, requireAdmin, async (c) => {
  const dbInstance = c.get('db');
  const user = c.get('user');
  if (!user?.id) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const customer = await getCustomerForUser(dbInstance, user.id);

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404);
  }

  const data = await c.req.json();

  try {
    // Get existing keys to merge
    const existingKeys = (customer.provider_keys || {}) as Record<string, any>;

    // Encrypt new keys and merge with existing
    const encryptedKeys = Object.entries(data as Record<string, any>).reduce((acc, [provider, config]) => {
      if (!config) return acc;
      
      const existing = existingKeys[provider];
      
      if (config.key && !config.key.startsWith('••••')) {
        // New key provided, encrypt it
        acc[provider] = {
          key: encryptKey(config.key),
          enabled: config.enabled,
          ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        };
      } else if (existing?.key) {
        // Keep existing key, update enabled status and endpoint
        acc[provider] = {
          key: existing.key,
          enabled: config.enabled,
          ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : 
            existing.endpoint ? { endpoint: existing.endpoint } : {}),
        };
      } else {
        // No key, just store enabled status
        acc[provider] = {
          enabled: config.enabled,
          ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        };
      }
      return acc;
    }, {} as Record<string, any>);

    // Update customer with new provider keys
    await dbInstance
      .update(schema.customers)
      .set({ provider_keys: encryptedKeys })
      .where(eq(schema.customers.id, customer.id));

    // Sync to Cloudflare AI Gateway
    const cfAccountId = (c.env as any)?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
    const cfApiToken = (c.env as any)?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;

    if (cfAccountId && cfApiToken && customer.cf_gateway_id) {
      try {
        const { updateCfProviderKeys } = await import('../lib/cloudflare-ai.js');

        // Build provider keys for Cloudflare (only enabled ones with actual keys)
        const cfProviderKeys: Record<string, { token: string }> = {};
        for (const [provider, config] of Object.entries(encryptedKeys)) {
          if (config.enabled && config.key) {
            cfProviderKeys[provider] = {
              token: decryptKey(config.key),
            };
          }
        }

        if (Object.keys(cfProviderKeys).length > 0) {
          await updateCfProviderKeys(cfAccountId, cfApiToken, customer.cf_gateway_id, cfProviderKeys);
        }
      } catch (err) {
        console.error('Failed to sync provider keys to Cloudflare:', err);
        // Don't fail the request, but log the error
      }
    }

    return c.json({ success: true, message: 'Provider keys updated' });
  } catch (error) {
    console.error('Error updating provider keys:', error);
    return c.json({ error: 'Failed to update provider keys' }, 500);
  }
});

// DELETE /v1/provider-keys/:provider - Remove a provider key (admin only)
router.delete('/provider-keys/:provider', authMiddleware, requireAdmin, async (c) => {
  const dbInstance = c.get('db');
  const user = c.get('user');
  if (!user?.id) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const customer = await getCustomerForUser(dbInstance, user.id);
  const provider = c.req.param('provider');

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404);
  }

  try {
    const providerKeys = { ...(customer.provider_keys || {}) };
    delete providerKeys[provider];

    await dbInstance
      .update(schema.customers)
      .set({ provider_keys: providerKeys })
      .where(eq(schema.customers.id, customer.id));

    // Sync to Cloudflare AI Gateway (remove the deleted key)
    const cfAccountId = (c.env as any)?.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
    const cfApiToken = (c.env as any)?.CF_AI_GATEWAY_API_TOKEN || process.env.CF_AI_GATEWAY_API_TOKEN;

    if (cfAccountId && cfApiToken && customer.cf_gateway_id) {
      try {
        const { updateCfProviderKeys } = await import('../lib/cloudflare-ai.js');

        // Build remaining provider keys for Cloudflare
        const cfProviderKeys: Record<string, { token: string }> = {};
        for (const [prov, config] of Object.entries(providerKeys as Record<string, { enabled?: boolean; key?: string }>)) {
          if (config.enabled && config.key) {
            cfProviderKeys[prov] = {
              token: decryptKey(config.key),
            };
          }
        }

        await updateCfProviderKeys(cfAccountId, cfApiToken, customer.cf_gateway_id, cfProviderKeys);
      } catch (err) {
        console.error('Failed to sync provider keys to Cloudflare after deletion:', err);
        // Don't fail the request, but log the error
      }
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting provider key:', error);
    return c.json({ error: 'Failed to delete provider key' }, 500);
  }
});

// GET /v1/provider-keys/models - Get available models based on configured providers
router.get('/provider-keys/models', authMiddleware, async (c) => {
  const dbInstance = c.get('db');
  const user = c.get('user');
  if (!user?.id) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const customer = await getCustomerForUser(dbInstance, user.id);

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404);
  }

  try {
    const providerKeys = (customer.provider_keys || {}) as Record<string, { enabled: boolean }>;
    const enabledProviders = Object.entries(providerKeys)
      .filter(([, config]) => config.enabled)
      .map(([provider]) => provider);

    // Define available models per provider
    const modelsByProvider: Record<string, string[]> = {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
      anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
      google: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      azure: ['gpt-4', 'gpt-4o', 'gpt-35-turbo'],
      groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma-7b-it'],
      cerebras: ['llama3.1-8b', 'llama3.1-70b'],
      mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
      cohere: ['command-r', 'command-r-plus'],
    };

    const availableModels = enabledProviders.flatMap(provider =>
      (modelsByProvider[provider] || []).map(model => `${provider}:${model}`)
    );

    return c.json({
      models: availableModels,
      providers: enabledProviders,
    });
  } catch (error) {
    console.error('Error fetching available models:', error);
    return c.json({ error: 'Failed to fetch available models' }, 500);
  }
});

export default router;
