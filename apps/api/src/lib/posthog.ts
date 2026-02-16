import { PostHog } from 'posthog-node';

const POSTHOG_KEY = process.env.POSTHOG_API_KEY ?? '';

let client: PostHog | null = null;

export function getPostHog(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, { host: 'https://us.i.posthog.com' });
  }
  return client;
}
