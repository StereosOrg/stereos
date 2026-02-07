import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export function PaymentSuccess() {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          window.location.href = '/';
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '500px',
          backgroundColor: '#111118',
          borderRadius: '16px',
          padding: '40px',
          border: '1px solid #1f2937',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: '#064e3b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            fontSize: '40px',
          }}
        >
          ✓
        </div>

        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            marginBottom: '12px',
            color: '#e2e8f0',
          }}
        >
          Payment Successful!
        </h1>

        <p style={{ color: '#9ca3af', marginBottom: '24px' }}>
          Your account is now active. You'll be redirected to the dashboard in {countdown} seconds.
        </p>

        <Link
          to="/"
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            borderRadius: '8px',
            backgroundColor: '#3b82f6',
            color: 'white',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Go to Dashboard Now
        </Link>
      </div>
    </div>
  );
}
