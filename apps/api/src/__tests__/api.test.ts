import { describe, it, expect } from 'vitest';
import app from '../index';

describe('API', () => {
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('404', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await app.request('/v1/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Not Found');
    });
  });

  describe('GET /v1/onboarding/status', () => {
    it('returns needsAuth when unauthenticated', async () => {
      const res = await app.request('/v1/onboarding/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('needsAuth');
      expect(body).toHaveProperty('needsOnboarding');
      expect(body).toHaveProperty('needsPayment');
    });
  });

  describe('POST /v1/billing/portal', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await app.request('/v1/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /v1/dashboard', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await app.request('/v1/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /v1/tool-profiles', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await app.request('/v1/tool-profiles');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/traces', () => {
    it('rejects invalid broadcast auth (401 or 503)', async () => {
      const res = await app.request('/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid',
        },
        body: JSON.stringify({ resourceSpans: [] }),
      });
      expect([401, 503]).toContain(res.status);
    });

    it('returns 401 without Authorization header', async () => {
      const res = await app.request('/v1/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceSpans: [] }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid body (missing resourceSpans)', async () => {
      const secret = process.env.OPENROUTER_BROADCAST_SECRET || 'test-secret';
      const res = await app.request('/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secret}`,
        },
        body: JSON.stringify({}),
      });
      if (res.status === 503) return;
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('resourceSpans');
    });
  });

  describe('OPTIONS /v1/traces', () => {
    it('returns success for preflight', async () => {
      const res = await app.request('/v1/traces', { method: 'OPTIONS' });
      expect([200, 204]).toContain(res.status);
    });
  });
});
