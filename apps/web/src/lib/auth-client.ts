import { createAuthClient } from 'better-auth/react';
import { API_BASE, BEARER_TOKEN_KEY } from './api';

const authBase = API_BASE
  ? `${API_BASE.replace(/\/$/, '')}/v1/auth`
  : typeof window !== 'undefined'
    ? `${window.location.origin}/v1/auth`
    : '';

export const authClient = createAuthClient({
  baseURL: authBase || undefined,
  fetchOptions: {
    credentials: 'include',
    // Cross-origin fallback when cookies are blocked: use Bearer token
    auth: {
      type: 'Bearer',
      token: () => (typeof window !== 'undefined' ? localStorage.getItem(BEARER_TOKEN_KEY) : null) || '',
    },
    onSuccess: (ctx) => {
      const token = ctx?.response?.headers?.get?.('set-auth-token');
      if (token && typeof window !== 'undefined') {
        localStorage.setItem(BEARER_TOKEN_KEY, token);
      }
    },
  },
});
