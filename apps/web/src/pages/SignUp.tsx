import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { getCallbackURL } from '../lib/api';
import { authClient } from '../lib/auth-client';

export function SignUp() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: getCallbackURL(redirect),
    });
    setLoading(false);
    if (err) {
      setError(err.message || 'Something went wrong');
      return;
    }
    navigate(`/auth/verify-email?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}`, { replace: true });
  };

  const handleSocialSignUp = (provider: 'github' | 'google') => {
    authClient.signIn.social({
      provider,
      callbackURL: getCallbackURL(redirect),
    });
  };

  return (
    <AuthLayout title="Create account" subtitle="Get started with STEREOS">
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

        <form onSubmit={handleEmailSignUp}>
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '8px',
              }}
            >
              Name
            </label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Jane Smith"
              autoComplete="name"
            />
          </div>
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
              autoComplete="new-password"
              minLength={8}
            />
            <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
              At least 8 characters
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: '20px' }}
          >
            {loading ? 'Creating account...' : 'Sign up'}
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
            onClick={() => handleSocialSignUp('github')}
          >
            Continue with GitHub
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: '100%' }}
            onClick={() => handleSocialSignUp('google')}
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
        Already have an account?{' '}
        <Link
          to={`/auth/sign-in${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
          style={{ color: 'var(--dark)', fontWeight: 600 }}
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
