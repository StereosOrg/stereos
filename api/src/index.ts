import { Hono } from "hono";
import { cors } from "hono/cors";
import { tokensRouter } from "./routes/tokens";
import { keysRouter } from "./routes/keys";
import { webhooksRouter } from "./routes/webhooks";

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  JWT_PRIVATE_KEY: string;
  ENVIRONMENT: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_API_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS configuration
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["POST", "GET", "OPTIONS", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (c) =>
  c.json({
    name: "Stereos API",
    version: "0.1.0",
    status: "ok",
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

// API routes
app.route("/v1/tokens", tokensRouter);
app.route("/v1/keys", keysRouter);
app.route("/v1/webhooks", webhooksRouter);

// 404 handler
app.notFound((c) =>
  c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  )
);

// Error handler
app.onError((err, c) => {
  console.error("API Error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message:
        c.env.ENVIRONMENT === "development" ? err.message : "An error occurred",
    },
    500
  );
});

export default app;
