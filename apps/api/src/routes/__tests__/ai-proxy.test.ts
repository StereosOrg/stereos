import { describe, it, expect } from 'vitest';
import { calculateCostUsd } from '../ai-proxy.js';
import app from '../../index.js';

describe('calculateCostUsd', () => {
  describe('20% markup applied to known models', () => {
    it('prices claude-sonnet-4-6 at $3.60/$18.00 per million tokens', () => {
      const cost = calculateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(3.60 + 18.00, 6);
    });

    it('prices claude-opus-4-6 at $6.00/$30.00 per million tokens', () => {
      const cost = calculateCostUsd('claude-opus-4-6', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(6.00 + 30.00, 6);
    });

    it('prices gpt-4o at $3.00/$12.00 per million tokens', () => {
      const cost = calculateCostUsd('gpt-4o', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(3.00 + 12.00, 6);
    });

    it('prices gpt-4o-mini at $0.18/$0.72 per million tokens', () => {
      const cost = calculateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.18 + 0.72, 6);
    });

    it('prices o1-pro at $180.00/$720.00 per million tokens', () => {
      const cost = calculateCostUsd('o1-pro', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(180.00 + 720.00, 6);
    });

    it('prices claude-haiku-4-5 at $1.20/$6.00 per million tokens', () => {
      const cost = calculateCostUsd('claude-haiku-4-5', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(1.20 + 6.00, 6);
    });
  });

  describe('proportional token counts', () => {
    it('scales linearly with token count', () => {
      const half = calculateCostUsd('gpt-4o', 500_000, 500_000);
      const full = calculateCostUsd('gpt-4o', 1_000_000, 1_000_000);
      expect(half).toBeCloseTo(full / 2, 6);
    });

    it('returns 0 for zero tokens', () => {
      expect(calculateCostUsd('claude-sonnet-4-6', 0, 0)).toBe(0);
    });

    it('costs only input tokens when completion is 0', () => {
      const cost = calculateCostUsd('gpt-4o', 1_000_000, 0);
      expect(cost).toBeCloseTo(3.00, 6);
    });

    it('costs only output tokens when prompt is 0', () => {
      const cost = calculateCostUsd('gpt-4o', 0, 1_000_000);
      expect(cost).toBeCloseTo(12.00, 6);
    });
  });

  describe('fallback pricing', () => {
    it('uses marked-up fallback ($3.60/$18.00) for unknown model', () => {
      const cost = calculateCostUsd('unknown-model-xyz', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(3.60 + 18.00, 6);
    });
  });

  describe('provider prefix stripping (prefix match)', () => {
    it('matches model with trailing version suffix', () => {
      // gpt-4o-2024-05-13 has explicit pricing at $6.00/$18.00
      const cost = calculateCostUsd('gpt-4o-2024-05-13', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(6.00 + 18.00, 6);
    });
  });
});

describe('AI Proxy routes', () => {
  describe('POST /v1/chat/completions', () => {
    it('returns 401 without an API key', async () => {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { code: string };
      expect(body.code).toBe('unauthorized');
    });
  });

  describe('POST /v1/responses', () => {
    it('returns 401 without an API key', async () => {
      const res = await app.request('/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/embeddings', () => {
    it('returns 401 without an API key', async () => {
      const res = await app.request('/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', input: 'test' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
