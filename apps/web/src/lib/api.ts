/**
 * API base URL. Empty in dev (Vite proxy). Set VITE_API_URL on Netlify to your Worker URL.
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string)?.trim() ?? '';

/**
 * Full URL for auth redirects. Better Auth resolves callbackURL against the API origin,
 * so we must pass the frontend origin (e.g. http://localhost:5173) so redirects land on the app.
 */
export function getCallbackURL(path: string = '/'): string {
  if (typeof window === 'undefined') return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${window.location.origin}${p}`;
}
