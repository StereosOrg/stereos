import { Hono } from "hono";
import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "../index";

export const tokensRouter = new Hono<{ Bindings: Env }>();

interface ApiKey {
  id: string;
  user_id: string;
  is_active: number;
}

// Default limits for paid integration
// These can be adjusted or made configurable per API key in the future
const DEFAULT_LIMITS = {
  conversions_per_token: 100,
  max_file_size: 100 * 1024 * 1024, // 100 MB
  token_ttl: 600, // 10 minutes
};

/**
 * POST /v1/tokens
 * Create a new processing token
 */
tokensRouter.post("/", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const apiKey = auth.slice(7);
  if (!apiKey) {
    return c.json({ error: "API key is required" }, 401);
  }

  // Hash the API key for lookup
  const keyHash = await hashApiKey(apiKey);

  // Look up API key in database
  const result = await c.env.DB.prepare(
    `SELECT id, user_id, is_active
     FROM api_keys
     WHERE key_hash = ? AND is_active = 1`
  )
    .bind(keyHash)
    .first<ApiKey>();

  if (!result) {
    return c.json({ error: "Invalid or deactivated API key" }, 401);
  }

  // Rate limiting (max 10 token requests per minute)
  const rateLimitKey = `rate:${result.id}:${Math.floor(Date.now() / 60000)}`;
  const currentRate = parseInt((await c.env.RATE_LIMIT.get(rateLimitKey)) ?? "0");
  if (currentRate >= 10) {
    return c.json(
      {
        error: "Rate limit exceeded",
        message: "Too many token requests, please wait a moment",
      },
      429
    );
  }
  await c.env.RATE_LIMIT.put(rateLimitKey, String(currentRate + 1), {
    expirationTtl: 120,
  });

  // Update last_used_at
  await c.env.DB.prepare(
    `UPDATE api_keys SET last_used_at = ? WHERE id = ?`
  )
    .bind(Math.floor(Date.now() / 1000), result.id)
    .run();

  // Generate token
  const now = Math.floor(Date.now() / 1000);
  const exp = now + DEFAULT_LIMITS.token_ttl;

  try {
    const privateKey = await importPKCS8(c.env.JWT_PRIVATE_KEY, "EdDSA");

    const token = await new SignJWT({
      sub: result.id,
      conversions_remaining: DEFAULT_LIMITS.conversions_per_token,
      max_file_size: DEFAULT_LIMITS.max_file_size,
      formats: ["glb", "gltf"],
    })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(privateKey);

    return c.json({
      token,
      expires_at: exp,
      conversions_remaining: DEFAULT_LIMITS.conversions_per_token,
    });
  } catch (err) {
    console.error("Token signing error:", err);
    return c.json({ error: "Failed to generate token" }, 500);
  }
});

/**
 * Hash an API key using SHA-256
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
