import { createAuthClient } from 'better-auth/react';
import { API_BASE } from './api';

const authBase = API_BASE
  ? `${API_BASE.replace(/\/$/, '')}/v1/auth`
  : typeof window !== 'undefined'
    ? `${window.location.origin}/v1/auth`
    : '';

export const authClient = createAuthClient({
  baseURL: authBase || undefined,
  // Required for cross-origin (e.g. Netlify → Workers): send cookies with every request
  fetchOptions: {
    credentials: 'include',
  },
});
