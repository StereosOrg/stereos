import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { CheckoutProvider, useCheckout, PaymentElement } from '@stripe/react-stripe-js';
import { CreditCard } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { API_BASE, getAuthHeaders } from '../lib/api';

// Neobrutalist Appearance API: matches apps/web/src/styles/neobrutalist.css (--dark, --border-width, --shadow-offset, .btn, .input)
const STRIPE_APPEARANCE = {
  theme: 'flat' as const,
  variables: {
    colorPrimary: '#1a1a1a',
    colorBackground: '#ffffff',
    colorText: '#1a1a1a',
    colorDanger: '#dc2626',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '0',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '3px solid #1a1a1a',
      boxShadow: '4px 4px 0 #1a1a1a',
      backgroundColor: '#ffffff',
    },
    '.Input:focus': {
      boxShadow: '4px 4px 0 #1a1a1a',
    },
    '.Input--invalid': {
      borderColor: '#dc2626',
      boxShadow: '4px 4px 0 #dc2626',
    },
    '.Label': {
      color: '#1a1a1a',
      fontWeight: '600',
    },
    '.Tab': {
      border: '3px solid #1a1a1a',
      boxShadow: '4px 4px 0 #1a1a1a',
      backgroundColor: '#ffffff',
    },
    '.Tab:hover': {
      color: '#1a1a1a',
    },
    '.Tab--selected': {
      borderColor: '#1a1a1a',
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
      boxShadow: '6px 6px 0 #1a1a1a',
    },
    '.Button': {
      border: '3px solid #1a1a1a',
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
      boxShadow: '6px 6px 0 #1a1a1a',
      fontWeight: '600',
    },
    '.Button:hover': {
      backgroundColor: '#2d2d2d',
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
    border: 'var(--border-width) solid var(--border-color)',
    boxShadow: 'var(--shadow-offset) var(--shadow-offset) 0 var(--border-color)',
  };

  const errorBlockStyle: React.CSSProperties = {
    background: 'var(--bg-pink)',
    border: 'var(--border-width) solid #dc2626',
    padding: '16px 20px',
    color: '#dc2626',
    fontWeight: 700,
    boxShadow: '4px 4px 0 #dc2626',
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
                  border: '3px solid var(--border-color)',
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
              border: '3px solid var(--border-color)',
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
              boxShadow: '4px 4px 0 var(--border-color)',
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
        const checkoutSdk = checkout as unknown as {
          loadActions: () => Promise<{ actions: { confirm: () => Promise<{ message?: string } | null> } }>;
        };
        const { actions } = await checkoutSdk.loadActions();
        const err = await actions.confirm();
        if (err) {
          onError(err.message ?? 'Payment failed');
          setSubmitting(false);
          return;
        }
        const sessionId = (checkout as { id?: string }).id;
        if (sessionId) {
          const res = await fetch(`${API_BASE}/v1/onboarding/confirm-checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            credentials: 'include',
            body: JSON.stringify({ session_id: sessionId }),
          });
          const data = await res.json();
          if (data.error) {
            onError(data.error);
            setSubmitting(false);
            return;
          }
        }
        navigate('/', { replace: true });
      } catch {
        onError('Something went wrong. Please try again.');
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
          border: 'var(--border-width) solid var(--border-color)',
          background: 'var(--dark)',
          color: 'white',
          boxShadow: 'var(--shadow-offset) var(--shadow-offset) 0 var(--border-color)',
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Processing…' : 'Subscribe'}
      </button>
    </form>
  );
}
