import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../index";

export const webhooksRouter = new Hono<{ Bindings: Env }>();

type WebhookContext = Context<{ Bindings: Env }>;

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: StripeSubscription | StripeCustomer;
  };
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  metadata: Record<string, string>;
}

interface StripeCustomer {
  id: string;
  email: string;
  metadata: Record<string, string>;
}

/**
 * POST /v1/webhooks/stripe
 * Handle Stripe webhook events
 */
webhooksRouter.post("/stripe", async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Missing Stripe signature" }, 400);
  }

  // Verify webhook signature
  const isValid = await verifyStripeSignature(
    payload,
    signature,
    c.env.STRIPE_WEBHOOK_SECRET
  );

  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 400);
  }

  const event: StripeEvent = JSON.parse(payload);

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(c, event.data.object as StripeSubscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(c, event.data.object as StripeSubscription);
        break;

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return c.json({ received: true });
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    return c.json({ error: "Failed to process webhook" }, 500);
  }
});

/**
 * Handle customer.subscription.created event
 * Creates a user and their first API key, then emails the key
 */
async function handleSubscriptionCreated(
  c: WebhookContext,
  subscription: StripeSubscription
): Promise<void> {
  const customerId = subscription.customer;
  const now = Math.floor(Date.now() / 1000);

  // Check if user already exists
  const existingUser = await c.env.DB.prepare(
    `SELECT id FROM users WHERE stripe_customer_id = ?`
  )
    .bind(customerId)
    .first<{ id: string }>();

  if (existingUser) {
    console.log(`User already exists for customer ${customerId}, updating subscription`);
    
    // Update subscription ID
    await c.env.DB.prepare(
      `UPDATE users SET stripe_subscription_id = ? WHERE id = ?`
    )
      .bind(subscription.id, existingUser.id)
      .run();
    
    // Reactivate any deactivated API keys
    await c.env.DB.prepare(
      `UPDATE api_keys SET is_active = 1 WHERE user_id = ?`
    )
      .bind(existingUser.id)
      .run();
    
    return;
  }

  // Fetch customer email from Stripe
  const customerEmail = await fetchStripeCustomerEmail(c, customerId);
  if (!customerEmail) {
    throw new Error(`Could not fetch email for Stripe customer ${customerId}`);
  }

  // Create new user
  const userId = generateId();

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, stripe_customer_id, stripe_subscription_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(userId, customerEmail, customerId, subscription.id, now)
    .run();

  // Generate initial API key for the user
  const keyId = generateId();
  const rawKey = `sk_${c.env.ENVIRONMENT === "production" ? "live" : "test"}_${generateKey()}`;
  const keyHash = await hashApiKey(rawKey);

  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, name, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  )
    .bind(keyId, userId, keyHash, "Default Key", now)
    .run();

  console.log(`Created user ${userId} with API key for customer ${customerId}`);

  // Email the API key to the customer
  await sendApiKeyEmail(c, customerEmail, rawKey);
}

/**
 * Fetch customer email from Stripe API
 */
async function fetchStripeCustomerEmail(
  c: WebhookContext,
  customerId: string
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${c.env.STRIPE_API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Stripe API error: ${error}`);
      return null;
    }

    const customer = await response.json() as { email?: string };
    return customer.email || null;
  } catch (err) {
    console.error("Error fetching Stripe customer:", err);
    return null;
  }
}

/**
 * Send API key email via Resend
 */
async function sendApiKeyEmail(
  c: WebhookContext,
  to: string,
  apiKey: string
): Promise<void> {
  const from = c.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your Stereos API Key</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .api-key { background: #1f2937; color: #10b981; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 14px; word-break: break-all; margin: 20px 0; }
    .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Stereos!</h1>
    </div>
    <div class="content">
      <p>Thank you for subscribing! Your API key is ready.</p>
      
      <div class="api-key">${apiKey}</div>
      
      <div class="warning">
        <strong>Important:</strong> Store this key securely. For security reasons, it will not be displayed again.
      </div>
      
      <p>Get started with our API:</p>
      <pre style="background: #f3f4f6; padding: 15px; border-radius: 6px; overflow-x: auto;">
curl -X POST https://api.stereos.dev/v1/tokens \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your-file.ply"}'</pre>
      
      <p>Need help? Reply to this email or visit our documentation.</p>
      
      <p>Best regards,<br>The Stereos Team</p>
    </div>
  </div>
</body>
</html>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${c.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Stereos <${from}>`,
      to: [to],
      subject: "Your Stereos API Key",
      html: htmlContent,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  const result = await response.json() as { id: string };
  console.log(`API key email sent to ${to}, Resend ID: ${result.id}`);
}

/**
 * Handle customer.subscription.deleted event
 * Deactivates all API keys for the user
 */
async function handleSubscriptionDeleted(
  c: WebhookContext,
  subscription: StripeSubscription
): Promise<void> {
  const customerId = subscription.customer;
  const now = Math.floor(Date.now() / 1000);

  // Find user by Stripe customer ID
  const user = await c.env.DB.prepare(
    `SELECT id FROM users WHERE stripe_customer_id = ?`
  )
    .bind(customerId)
    .first<{ id: string }>();

  if (!user) {
    console.log(`No user found for customer ${customerId}`);
    return;
  }

  // Deactivate all API keys for this user
  const result = await c.env.DB.prepare(
    `UPDATE api_keys 
     SET is_active = 0, deactivated_at = ?
     WHERE user_id = ? AND is_active = 1`
  )
    .bind(now, user.id)
    .run();

  // Clear subscription ID from user
  await c.env.DB.prepare(
    `UPDATE users SET stripe_subscription_id = NULL WHERE id = ?`
  )
    .bind(user.id)
    .run();

  console.log(
    `Deactivated ${result.meta.changes} API keys for user ${user.id} (customer ${customerId})`
  );
}

/**
 * Verify Stripe webhook signature using Web Crypto API
 */
async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Stripe signature format: t=timestamp,v1=signature
    const elements = signature.split(",");
    const signatureMap = new Map<string, string>();

    for (const element of elements) {
      const [key, value] = element.split("=");
      signatureMap.set(key.trim(), value.trim());
    }

    const timestamp = signatureMap.get("t");
    const sig = signatureMap.get("v1");

    if (!timestamp || !sig) {
      return false;
    }

    // Check timestamp is within tolerance (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(timestamp, 10);
    if (Math.abs(now - eventTime) > 300) {
      return false;
    }

    // Construct the signed payload
    const signedPayload = `${timestamp}.${payload}`;

    // Decode the secret (Stripe webhook secrets are base64 encoded)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    // Import the key
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Sign the payload
    const signatureData = encoder.encode(signedPayload);
    const computedSig = await crypto.subtle.sign("HMAC", cryptoKey, signatureData);

    // Convert to hex string for comparison
    const computedSigHex = Array.from(new Uint8Array(computedSig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (computedSigHex.length !== sig.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < computedSigHex.length; i++) {
      result |= computedSigHex.charCodeAt(i) ^ sig.charCodeAt(i);
    }

    return result === 0;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

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
