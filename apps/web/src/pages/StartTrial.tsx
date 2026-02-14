import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { CheckoutProvider, useCheckout, PaymentElement } from '@stripe/react-stripe-js';
import { CreditCard } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { API_BASE, getAuthHeaders } from '../lib/api';

// Stripe appearance: matches apps/web/src/styles/neobrutalist.css border & elevation system
const STRIPE_APPEARANCE = {
  theme: 'flat' as const,
  variables: {
    colorPrimary: '#111827',
    colorBackground: '#ffffff',
    colorText: '#111827',
    colorDanger: '#dc2626',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '6px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '1px solid #d1d5db',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      backgroundColor: '#ffffff',
    },
    '.Input:focus': {
      borderColor: '#2563eb',
      boxShadow: '0 0 0 3px rgba(37,99,235,0.15)',
    },
    '.Input--invalid': {
      borderColor: '#dc2626',
      boxShadow: '0 0 0 2px rgba(220,38,38,0.15)',
    },
    '.Label': {
      color: '#111827',
      fontWeight: '600',
    },
    '.Tab': {
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      backgroundColor: '#ffffff',
    },
    '.Tab:hover': {
      color: '#111827',
    },
    '.Tab--selected': {
      borderColor: '#111827',
      backgroundColor: '#111827',
      color: '#ffffff',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.04)',
    },
    '.Button': {
      border: '1px solid #111827',
      backgroundColor: '#111827',
      color: '#ffffff',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.04)',
      fontWeight: '600',
    },
    '.Button:hover': {
      backgroundColor: '#1f2937',
    },
    '.Error': {
      color: '#dc2626',
      fontWeight: '700',
    },
  },
};

// Only use keys that look like publishable keys (pk_...). Never pass secret keys (sk_...) to Stripe.js.
const rawStripeKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string)?.trim() ?? '';
const stripePublishableKey = rawStripeKey.startsWith('pk_') ? rawStripeKey : '';
const hasWrongKey = rawStripeKey.length > 0 && rawStripeKey.startsWith('sk_');

export function StartTrial() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Returned from Stripe after payment: confirm session and redirect to app
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    setConfirming(true);

    fetch(`${API_BASE}/v1/onboarding/confirm-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setConfirming(false);
          return;
        }
        navigate('/', { replace: true });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to confirm payment');
          setConfirming(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  // Non-admins should not see start-trial; redirect to pending
  useEffect(() => {
    if (sessionId) return;
    let cancelled = false;
    fetch(`${API_BASE}/v1/onboarding/status`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.needsPayment && !data.isAdmin) {
          navigate('/onboarding/pending', { replace: true });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  // Create embedded checkout session when no session_id in URL (admins only)
  useEffect(() => {
    if (sessionId) return;

    let cancelled = false;

    fetch(`${API_BASE}/v1/onboarding/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setLoading(false);
          return;
        }
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load checkout');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const stripePromise = useMemo(
    () => (stripePublishableKey ? loadStripe(stripePublishableKey) : null),
    []
  );

  const cardStyle: React.CSSProperties = {
    padding: 0,
    overflow: 'visible',
    background: 'var(--bg-white)',
    border: '1px solid var(--border-default)',
    boxShadow: 'var(--shadow-md)',
  };

  const errorBlockStyle: React.CSSProperties = {
    background: '#fef2f2',
    border: '1px solid #dc2626',
    borderRadius: '8px',
    padding: '16px 20px',
    color: '#dc2626',
    fontWeight: 700,
  };

  if (sessionId) {
    return (
      <AuthLayout title="Start your trial" subtitle="Confirming your payment…">
        <div className="card" style={{ ...cardStyle, padding: '32px', textAlign: 'center' }}>
          {confirming && !error && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  border: '2px solid var(--border-default)',
                  borderTopColor: 'var(--dark)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <p style={{ color: 'var(--dark)', fontWeight: 600 }}>One moment…</p>
            </div>
          )}
          {error && <div style={errorBlockStyle}>{error}</div>}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </AuthLayout>
    );
  }

  if (!stripePublishableKey) {
    return (
      <AuthLayout title="Start your trial">
        <div className="card" style={{ ...cardStyle, padding: '24px' }}>
          <p style={{ color: 'var(--dark)', fontSize: '15px', lineHeight: 1.6 }}>
            {hasWrongKey ? (
              <>
                Use your <strong>publishable</strong> key (<code>pk_test_...</code> or <code>pk_live_...</code>) in{' '}
                <code>VITE_STRIPE_PUBLISHABLE_KEY</code>, not your secret key. Secret keys must stay on the server only.
              </>
            ) : (
              'Stripe is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY (publishable key) to enable checkout.'
            )}
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (loading) {
    return (
      <AuthLayout title="Start your trial" subtitle="Loading checkout…">
        <div className="card" style={{ ...cardStyle, padding: '40px', textAlign: 'center' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              margin: '0 auto 16px',
                  border: '2px solid var(--border-default)',
              borderTopColor: 'var(--dark)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <p style={{ color: 'var(--dark)', fontWeight: 600 }}>Loading…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </AuthLayout>
    );
  }

  if (error && !clientSecret) {
    return (
      <AuthLayout title="Start your trial">
        <div className="card" style={{ ...cardStyle, padding: '24px' }}>
          <div style={errorBlockStyle}>{error}</div>
        </div>
      </AuthLayout>
    );
  }

  if (!clientSecret) {
    return (
      <AuthLayout title="Start your trial">
        <div className="card" style={{ ...cardStyle, padding: '24px' }}>
          <p style={{ color: 'var(--dark)' }}>Unable to start checkout. Please try again.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Start your trial"
      subtitle="Complete payment below to continue. You can only proceed after checkout is done."
      contentMaxWidth={560}
    >
      <div className="card" style={cardStyle}>
        <div
          style={{
            borderBottom: 'var(--border-width) solid var(--border-color)',
            padding: '20px 24px',
            background: 'var(--bg-white)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              border: 'var(--border-width) solid var(--border-color)',
              background: 'var(--bg-mint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <CreditCard size={22} color="var(--dark)" strokeWidth={3} />
          </div>
          <p style={{ color: 'var(--dark)', fontSize: '15px', margin: 0, fontWeight: 600 }}>
            Enter your payment details below. When finished, you’ll be able to continue.
          </p>
        </div>
        <div style={{ padding: '24px', width: '100%' }}>
          {error && (
            <div style={{ ...errorBlockStyle, marginBottom: '20px' }}>{error}</div>
          )}
          {stripePromise && (
            <CheckoutProvider
              key={clientSecret}
              stripe={stripePromise}
              options={{
                fetchClientSecret: () => Promise.resolve(clientSecret),
                elementsOptions: { appearance: STRIPE_APPEARANCE },
              } as any}
            >
              <CheckoutForm onError={setError} />
            </CheckoutProvider>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}

function CheckoutForm({ onError }: { onError: (msg: string) => void }) {
  const navigate = useNavigate();
  const checkout = useCheckout();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!checkout || submitting) return;
      setSubmitting(true);
      onError('');
      try {
        type ConfirmResult = { message?: string } | null;
        type CheckoutConfirm = () => Promise<ConfirmResult>;
        const confirmFn: CheckoutConfirm | undefined =
          typeof (checkout as { confirm?: unknown }).confirm === 'function'
            ? (checkout as { confirm: CheckoutConfirm }).confirm
            : undefined;
        if (!confirmFn) {
          const c = checkout as unknown as {
            loadActions?: () => Promise<{ actions: { confirm: CheckoutConfirm } }>;
          };
          if (typeof c.loadActions === 'function') {
            const { actions } = await c.loadActions();
            const err = await actions.confirm();
            if (err) {
              onError(err.message ?? 'Payment failed');
              setSubmitting(false);
              return;
            }
          } else {
            onError('Checkout confirm is not available. Please refresh and try again.');
            setSubmitting(false);
            return;
          }
        } else {
          const err = await confirmFn();
          if (err) {
            onError(err.message ?? 'Payment failed');
            setSubmitting(false);
            return;
          }
        }
        const sessionId = (checkout as { id?: string }).id;
        if (sessionId) {
          const res = await fetch(`${API_BASE}/v1/onboarding/confirm-checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            credentials: 'include',
            body: JSON.stringify({ session_id: sessionId }),
          });
          const text = await res.text();
          let body: { error?: string; message?: string } = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch {
            body = { error: res.ok ? undefined : text || `Request failed (${res.status})` };
          }
          if (!res.ok) {
            onError(typeof body?.error === 'string' ? body.error : body?.message ?? `Request failed (${res.status})`);
            setSubmitting(false);
            return;
          }
          if (body.error) {
            onError(body.error);
            setSubmitting(false);
            return;
          }
        }
        navigate('/', { replace: true });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong. Please try again.';
        onError(message);
        if (process.env.NODE_ENV !== 'production') {
          console.error('Start-trial submit error:', e);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [checkout, submitting, onError, navigate]
  );

  if (!checkout) return null;

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      <div style={{ marginBottom: '20px', minHeight: '280px' }}>
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="btn btn-primary"
        style={{
          width: '100%',
          padding: '12px 24px',
          fontSize: '16px',
          fontWeight: 600,
          border: '1px solid var(--dark)',
          background: 'var(--dark)',
          color: 'white',
          boxShadow: 'var(--shadow-md)',
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Processing…' : 'Subscribe'}
      </button>
    </form>
  );
}
