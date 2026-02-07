import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { AuthLayout } from '../components/AuthLayout';
import { API_BASE } from '../lib/api';

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
      headers: { 'Content-Type': 'application/json' },
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
    fetch(`${API_BASE}/v1/onboarding/status`, { credentials: 'include' })
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
      headers: { 'Content-Type': 'application/json' },
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

  if (sessionId) {
    return (
      <AuthLayout title="Start your trial" subtitle="Confirming your payment…">
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          {confirming && !error && (
            <p style={{ color: '#555', marginBottom: '16px' }}>One moment…</p>
          )}
          {error && (
            <div
              style={{
                background: '#fee2e2',
                border: '3px solid #dc2626',
                padding: '16px',
                color: '#dc2626',
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </AuthLayout>
    );
  }

  if (!stripePublishableKey) {
    return (
      <AuthLayout title="Start your trial">
        <div className="card" style={{ padding: '24px' }}>
          {hasWrongKey ? (
            <p style={{ color: '#666' }}>
              Use your <strong>publishable</strong> key (<code>pk_test_...</code> or <code>pk_live_...</code>) in{' '}
              <code>VITE_STRIPE_PUBLISHABLE_KEY</code>, not your secret key (<code>sk_...</code>). Secret keys must
              stay on the server only.
            </p>
          ) : (
            <p style={{ color: '#666' }}>
              Stripe is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY (publishable key) to enable checkout.
            </p>
          )}
        </div>
      </AuthLayout>
    );
  }

  if (loading) {
    return (
      <AuthLayout title="Start your trial" subtitle="Loading checkout…">
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <p style={{ color: '#555' }}>Loading…</p>
        </div>
      </AuthLayout>
    );
  }

  if (error && !clientSecret) {
    return (
      <AuthLayout title="Start your trial">
        <div className="card" style={{ padding: '24px' }}>
          <div
            style={{
              background: '#fee2e2',
              border: '3px solid #dc2626',
              padding: '16px',
              color: '#dc2626',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (!clientSecret) {
    return (
      <AuthLayout title="Start your trial">
        <div className="card" style={{ padding: '24px' }}>
          <p style={{ color: '#666' }}>Unable to start checkout. Please try again.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Start your trial"
      subtitle="Complete payment below to continue. You can only proceed after checkout is done."
      contentMaxWidth={720}
    >
      <div
        className="card"
        style={{
          padding: 0,
          overflow: 'visible',
          background: 'var(--bg-white)',
          border: 'var(--border-width) solid var(--border-color)',
          boxShadow: 'var(--shadow-offset) var(--shadow-offset) 0 var(--border-color)',
        }}
      >
        <div
          style={{
            borderBottom: 'var(--border-width) solid var(--border-color)',
            padding: '20px 24px',
            background: 'var(--bg-white)',
          }}
        >
          <p style={{ color: 'var(--dark)', fontSize: '15px', margin: 0, fontWeight: 500 }}>
            Enter your payment details below. When finished, you’ll be able to continue.
          </p>
        </div>
        <div
          id="stripe-embedded-checkout"
          style={{
            minHeight: '520px',
            width: '100%',
            display: 'block',
            paddingBottom: '24px',
          }}
        >
          {stripePromise && clientSecret && (
            <EmbeddedCheckoutProvider
              key={clientSecret}
              stripe={stripePromise}
              options={{ clientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
