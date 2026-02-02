import { Hono } from "hono";
import type { Env } from "../index";

export const keysRouter = new Hono<{ Bindings: Env }>();

interface ApiKey {
  id: string;
  user_id: string;
  name: string | null;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
}

/**
 * POST /v1/keys
 * Create a new API key
 *
 * This is a simplified version - in production you'd have
 * proper authentication (e.g., session tokens, OAuth)
 */
keysRouter.post("/", async (c) => {
  const body = await c.req.json<{
    user_id: string;
    name?: string;
  }>();

  if (!body.user_id) {
    return c.json({ error: "user_id is required" }, 400);
  }

  // Generate a new API key
  const keyId = generateId();
  const rawKey = `sk_${c.env.ENVIRONMENT === "production" ? "live" : "test"}_${generateKey()}`;
  const keyHash = await hashApiKey(rawKey);

  const now = Math.floor(Date.now() / 1000);

  try {
    await c.env.DB.prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, name, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
      .bind(keyId, body.user_id, keyHash, body.name ?? null, now)
      .run();

    return c.json({
      id: keyId,
      key: rawKey, // Only returned once!
      name: body.name ?? null,
      is_active: true,
      created_at: now,
      message: "Store this key securely - it will not be shown again",
    });
  } catch (err) {
    console.error("Key creation error:", err);
    return c.json({ error: "Failed to create API key" }, 500);
  }
});

/**
 * GET /v1/keys
 * List API keys for a user (without the actual key values)
 */
keysRouter.get("/", async (c) => {
  const userId = c.req.query("user_id");
  if (!userId) {
    return c.json({ error: "user_id query parameter is required" }, 400);
  }

  const results = await c.env.DB.prepare(
    `SELECT id, name, is_active, created_at, last_used_at
     FROM api_keys
     WHERE user_id = ? AND is_active = 1
     ORDER BY created_at DESC`
  )
    .bind(userId)
    .all<ApiKey>();

  return c.json({
    keys: results.results.map((key) => ({
      id: key.id,
      name: key.name,
      is_active: key.is_active === 1,
      created_at: key.created_at,
      last_used_at: key.last_used_at,
    })),
  });
});

/**
 * DELETE /v1/keys/:id
 * Deactivate an API key
 */
keysRouter.delete("/:id", async (c) => {
  const keyId = c.req.param("id");
  const userId = c.req.query("user_id");

  if (!userId) {
    return c.json({ error: "user_id query parameter is required" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  const result = await c.env.DB.prepare(
    `UPDATE api_keys
     SET is_active = 0, deactivated_at = ?
     WHERE id = ? AND user_id = ? AND is_active = 1`
  )
    .bind(now, keyId, userId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: "API key not found or already deactivated" }, 404);
  }

  return c.json({ success: true, message: "API key deactivated" });
});

/**
 * Generate a random ID
 */
function generateId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a random API key
 */
function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash an API key using SHA-256
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
