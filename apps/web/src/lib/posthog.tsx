import { useEffect } from 'react';
import posthog from 'posthog-js';

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY as string)?.trim() ?? '';
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string)?.trim() || 'https://us.i.posthog.com';

let initialized = false;

export function initPostHog() {
  if (initialized || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: true,
  });
  initialized = true;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  return <>{children}</>;
}

export { posthog };
