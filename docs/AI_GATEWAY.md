# AI Gateway: Proxy + Vercel AI SDK + Tool Integrations

This document keeps the current proxy in place but aligns usage with modern OpenAI-compatible tooling and Cloudflare AI Gateway.

## Proxy Summary (kept)

The proxy remains available and is OpenAI-compatible. It forwards requests to Cloudflare AI Gateway and records usage in `GatewayEvent` while emitting OTEL spans.

**Endpoints** (OpenAI-compatible):
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `POST /v1/images/generations`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `POST /v1/moderations`

**Auth headers supported by the proxy:**
- `x-stereos-virtual-key: <key>` (preferred)
- `Authorization: Bearer <key>`
- `x-api-key: <key>`

## Vercel AI SDK + Cloudflare AI Gateway (recommended client path)

Use Cloudflare’s official Vercel AI SDK integration via `ai-gateway-provider`.

```ts
import { createAiGateway } from 'ai-gateway-provider';
import { createUnified } from 'ai-gateway-provider/providers/unified';
import { generateText } from 'ai';

const aigateway = createAiGateway({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  gateway: process.env.CLOUDFLARE_GATEWAY_ID!,
  apiKey: process.env.CF_AIG_TOKEN!,
});

const unified = createUnified();

const { text } = await generateText({
  model: aigateway(unified('openai/gpt-5.2')),
  prompt: 'What is Cloudflare?',
});
```

Notes:
- This path goes directly to Cloudflare AI Gateway (no proxy). It’s the cleanest path for teams already managing BYOK in Cloudflare.
- If you need our budget enforcement or `GatewayEvent` tracking, use the proxy instead.

## Vercel AI SDK + Stereos Proxy (OpenAI-compatible)

This routes through the proxy so budget enforcement and `GatewayEvent` tracking still work.

```ts
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const stereos = createOpenAICompatible({
  baseURL: '{STEREOS_API_BASE}/v1',
  apiKey: '{STEREOS_VIRTUAL_KEY}',
});

const { text } = await generateText({
  model: stereos('gpt-4o'),
  prompt: 'Hello, world!',
});

console.log(text);
```

## Kilo Code (OpenAI-Compatible)

Kilo Code supports OpenAI-compatible providers with a **Base URL** and **API Key** configuration.

Recommended settings:
- API Provider: `OpenAI Compatible`
- Base URL: `{STEREOS_API_BASE}/v1`
- API Key: your Stereos virtual key
- Model: a supported model string, e.g. `gpt-4o` or `claude-sonnet-4-5-20250929`

Kilo Code also accepts full endpoint URLs (if needed):
- `{STEREOS_API_BASE}/v1/chat/completions`

## OpenCode

OpenCode supports OpenAI-compatible providers via `@ai-sdk/openai-compatible` in `opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "stereos": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Stereos Proxy",
      "options": {
        "baseURL": "{STEREOS_API_BASE}/v1",
        "apiKey": "{STEREOS_VIRTUAL_KEY}"
      },
      "models": {
        "gpt-4o": { "name": "GPT-4o" },
        "claude-sonnet-4-5-20250929": { "name": "Claude Sonnet 4.5" }
      }
    }
  }
}
```

If you prefer to avoid storing the key in the config file, you can remove `apiKey` and use environment-based auth if your OpenCode setup supports it.
