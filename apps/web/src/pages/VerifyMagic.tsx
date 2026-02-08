import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { API_BASE, BEARER_TOKEN_KEY } from '../lib/api';

/**
 * User lands here from the magic link in email (?token=...).
 * We exchange the token for a session and redirect to /.
 */
export function VerifyMagic() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Missing link. Request a new sign-in link.');
      return;
    }
    const apiUrl = API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
    fetch(`${apiUrl}/v1/auth/magic-link/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.session_token) {
          localStorage.setItem(BEARER_TOKEN_KEY, data.session_token);
          navigate('/', { replace: true });
        } else {
          setError(data.error || 'Invalid or expired link.');
        }
      })
      .catch(() => setError('Something went wrong. Try again.'));
  }, [token, navigate]);

  if (error) {
    return (
      <AuthLayout title="Sign-in link invalid" subtitle="Request a new one">
        <div className="card" style={{ background: 'var(--bg-white)' }}>
          <p style={{ color: '#dc2626', marginBottom: '16px' }}>{error}</p>
          <a href="/auth/sign-in" className="btn btn-primary">
            Back to sign in
          </a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Signing you in" subtitle="One moment...">
      <div className="card" style={{ background: 'var(--bg-white)', textAlign: 'center' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '3px solid var(--border-color)',
            borderTopColor: 'var(--dark)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: '#555', fontSize: '15px' }}>Verifying your link...</p>
      </div>
    </AuthLayout>
  );
}
