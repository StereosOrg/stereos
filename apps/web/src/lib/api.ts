/**
 * API base URL. Empty in dev (Vite proxy). Set VITE_API_URL when building for production (Vercel, Netlify, etc.) to your API origin so auth and API calls hit the same backend.
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string)?.trim() ?? '';

/** localStorage key for Bearer token (used when cross-origin cookies are blocked). */
export const BEARER_TOKEN_KEY = 'stereos_bearer_token';

/**
 * Headers to add to API requests when we have a Bearer token (cross-origin fallback).
 * Call this in the browser; returns {} in SSR.
 */
export function getAuthHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem(BEARER_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Full URL for auth redirects. Better Auth resolves callbackURL against the API origin,
 * so we must pass the frontend origin (e.g. http://localhost:5173) so redirects land on the app.
 */
export function getCallbackURL(path: string = '/'): string {
  if (typeof window === 'undefined') return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${window.location.origin}${p}`;
}

/**
 * Consume session_token from the current URL (after email verification redirect), store it,
 * and return the URL without the param. Call once on app load.
 */
export function consumeSessionTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('session_token');
  if (token) {
    localStorage.setItem(BEARER_TOKEN_KEY, token);
    params.delete('session_token');
    const search = params.toString();
    const newUrl = search ? `${window.location.pathname}?${search}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }
}

