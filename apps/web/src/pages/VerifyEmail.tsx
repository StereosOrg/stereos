import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { Mail } from 'lucide-react';

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || 'your email';

  return (
    <AuthLayout title="Check your email" subtitle="Verify your STEREOS account">
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
          <Mail size={28} color="var(--dark)" />
        </div>
        <p style={{ fontSize: '16px', color: '#555', lineHeight: 1.6, marginBottom: '20px' }}>
          We sent a verification link to <strong>{email}</strong>. Click the link in that email to verify your account—you’ll be signed in and redirected to the app.
        </p>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>
          Didn’t get the email? Check your spam folder, or try signing up again.
        </p>
        <Link
          to="/auth/sign-in"
          className="btn btn-primary"
          style={{ display: 'inline-block', textDecoration: 'none' }}
        >
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
