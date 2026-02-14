import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { getCallbackURL } from '../lib/api';
import { authClient } from '../lib/auth-client';


export function SignIn() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await authClient.signIn.magicLink({
      email,
      callbackURL: getCallbackURL(redirect),
    });
    setLoading(false);
    if (err) {
      setError(err.message || 'Something went wrong');
      return;
    }
    setSent(true);
  };


  if (sent) {
    return (
      <AuthLayout title="Check your email" subtitle="We sent you a sign-in link">
        <div className="card" style={{ background: 'var(--bg-white)' }}>
          <p style={{ fontSize: '15px', lineHeight: 1.6, marginBottom: '16px' }}>
            We sent a magic link to <strong>{email}</strong>. Click the link in your email to sign in.
          </p>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px' }}>
            The link expires in 10 minutes. Check your spam folder if you don't see it.
          </p>
          <button
            type="button"
            className="btn"
            style={{ width: '100%' }}
            onClick={() => {
              setSent(false);
              setError('');
            }}
          >
            Try a different email
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" subtitle="Welcome to STEREOS">
      <div className="card" style={{ background: 'var(--bg-white)' }}>
        {error && (
          <div
            style={{
              background: '#fee2e2',
              border: '1px solid #dc2626',
              padding: '12px 16px',
              marginBottom: '20px',
              color: '#dc2626',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleMagicLink}>
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '8px',
              }}
            >
              Email
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: '20px' }}
          >
            {loading ? 'Sending link...' : 'Send magic link'}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
