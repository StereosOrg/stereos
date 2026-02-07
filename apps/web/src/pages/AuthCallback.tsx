import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';

/**
 * Shown briefly when returning from OAuth (e.g. GitHub). The API usually
 * redirects directly to callbackURL with cookies set; this page is a fallback
 * if the user lands on /auth/callback.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => navigate('/', { replace: true }), 1500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <AuthLayout title="Completing sign in" subtitle="Taking you to STEREOS...">
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
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <p style={{ color: '#555', fontSize: '15px' }}>One moment...</p>
      </div>
    </AuthLayout>
  );
}
