import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { CreditCard } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { API_BASE, getAuthHeaders } from '../lib/api';

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
        {/* Stripe Embedded Checkout (iframe). Match our aesthetic in Stripe Dashboard → Branding: button #1a1a1a, background #ffffff, font Inter, sharp corners. */}
        <div
          id="stripe-embedded-checkout"
          style={{
            minHeight: '480px',
            width: '100%',
            display: 'block',
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
