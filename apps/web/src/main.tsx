import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { consumeSessionTokenFromUrl } from './lib/api';
import App from './App';
import { PostHogProvider } from './lib/posthog';
import './index.css';
import './styles/neobrutalist.css';

// After email verification we redirect with ?session_token=...; store it and strip from URL
consumeSessionTokenFromUrl();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </PostHogProvider>
  </StrictMode>
);
