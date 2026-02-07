import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { getCallbackURL } from '../lib/api';
import { authClient } from '../lib/auth-client';

export function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data, error: err } = await authClient.signIn.email({
      email,
      password,
      callbackURL: getCallbackURL(redirect),
    });
    setLoading(false);
    if (err) {
      const msg = err.message || '';
      const needsVerification = err.status === 403 || /verify|verification/i.test(msg);
      setError(needsVerification ? 'Please verify your email first. Check your inbox for the verification link.' : msg || 'Invalid email or password');
      return;
    }
    if (data?.url) {
      window.location.href = data.url;
    } else {
      navigate(redirect, { replace: true });
    }
  };

  const handleSocialSignIn = (provider: 'github' | 'google') => {
    authClient.signIn.social({
      provider,
      callbackURL: getCallbackURL(redirect),
    });
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back to STEREOS">
      <div className="card" style={{ background: 'var(--bg-white)' }}>
        {error && (
          <div
            style={{
              background: '#fee2e2',
              border: '3px solid #dc2626',
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

        <form onSubmit={handleEmailSignIn}>
          <div style={{ marginBottom: '16px' }}>
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
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '8px',
              }}
            >
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: '20px' }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              flex: 1,
              height: '2px',
              background: 'var(--border-color)',
            }}
          />
          <span style={{ fontSize: '13px', color: '#666' }}>or</span>
          <div
            style={{
              flex: 1,
              height: '2px',
              background: 'var(--border-color)',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            type="button"
            className="btn"
            style={{ width: '100%' }}
            onClick={() => handleSocialSignIn('github')}
          >
            Continue with GitHub
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: '100%' }}
            onClick={() => handleSocialSignIn('google')}
          >
            Continue with Google
          </button>
        </div>
      </div>

      <p
        style={{
          textAlign: 'center',
          color: '#555',
          fontSize: '14px',
          marginTop: '24px',
        }}
      >
        Don't have an account?{' '}
        <Link
          to={`/auth/sign-up${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
          style={{ color: 'var(--dark)', fontWeight: 600 }}
        >
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
