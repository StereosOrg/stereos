import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { API_BASE, getCallbackURL } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { MailCheck } from 'lucide-react';

export function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'success'>('loading');
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    fetch(`${API_BASE}/v1/invites/validate?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.valid) {
          setEmail(data.email);
          setWorkspaceName(data.workspaceName || 'the workspace');
          setStatus('valid');
        } else {
          setStatus('invalid');
        }
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept invite');

      const { error: signInErr } = await authClient.signIn.email({
        email: email.trim(),
        password,
        callbackURL: getCallbackURL('/onboarding'),
      });
      if (signInErr) {
        setStatus('success');
        return;
      }
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <AuthLayout title="Accept invite" subtitle="Loading…">
        <div className="card" style={{ background: 'var(--bg-white)', padding: '48px', textAlign: 'center' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              border: '1px solid var(--border-default)',
              borderTopColor: 'var(--bg-mint)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'invalid') {
    return (
      <AuthLayout title="Invalid invite" subtitle="This link may have expired or already been used">
        <div className="card" style={{ background: 'var(--bg-white)', maxWidth: '420px' }}>
          <p style={{ color: '#555', marginBottom: '20px' }}>
            The invite link is invalid or has expired. Ask your admin to send a new invite.
          </p>
          <Link to="/auth/sign-in" className="btn btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'success') {
    return (
      <AuthLayout title="You're in" subtitle="Join your workspace">
        <div className="card" style={{ background: 'var(--bg-white)', maxWidth: '420px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '12px',
              background: 'var(--bg-mint)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px',
            }}
          >
            <MailCheck size={28} color="var(--dark)" />
          </div>
          <p style={{ fontSize: '16px', color: '#555', lineHeight: 1.6, marginBottom: '24px' }}>
            Your account is ready. Sign in with your email and password to access {workspaceName}.
          </p>
          <Link
            to="/auth/sign-in"
            className="btn btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Join the workspace" subtitle={`You're invited to ${workspaceName}`}>
      <div className="card" style={{ background: 'var(--bg-white)', maxWidth: '420px' }}>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Email</label>
            <input
              type="email"
              className="input"
              value={email}
              readOnly
              style={{ width: '100%', background: 'var(--bg-cream)', color: '#555' }}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Your name</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              required
              autoComplete="name"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="new-password"
              style={{ width: '100%' }}
            />
            <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>At least 8 characters</p>
          </div>
          {error && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#fee2e2', border: '1px solid #dc2626', color: '#dc2626', fontWeight: 600, fontSize: '14px' }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '16px' }} disabled={submitLoading}>
            {submitLoading ? 'Creating account…' : 'Accept invite'}
          </button>
        </form>
        <p style={{ fontSize: '14px', color: '#666' }}>
          Already have an account? <Link to="/auth/sign-in" style={{ color: 'var(--dark)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
