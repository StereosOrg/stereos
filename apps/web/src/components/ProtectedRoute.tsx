import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const [status, setStatus] = useState<{
    loading: boolean;
    needsAuth: boolean;
    needsOnboarding: boolean;
    needsPayment: boolean;
    isAdmin?: boolean;
  }>({
    loading: true,
    needsAuth: false,
    needsOnboarding: false,
    needsPayment: false,
    isAdmin: false,
  });

  useEffect(() => {
    // Check onboarding status
    fetch(`${API_BASE}/v1/onboarding/status`, {
      credentials: 'include',
      headers: getAuthHeaders(),
    })
      .then((res) => {
        if (res.status === 401) {
          setStatus({
            loading: false,
            needsAuth: true,
            needsOnboarding: false,
            needsPayment: false,
          });
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setStatus({
            loading: false,
            needsAuth: data.needsAuth ?? false,
            needsOnboarding: data.needsOnboarding ?? false,
            needsPayment: data.needsPayment ?? false,
            isAdmin: data.isAdmin,
          });
        }
      })
      .catch(() => {
        setStatus({
          loading: false,
          needsAuth: true,
          needsOnboarding: false,
          needsPayment: false,
        });
      });
  }, []);

  if (status.loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '1px solid var(--border-strong)',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Check auth first
  if (status.needsAuth) {
    // Redirect to login with return URL
    return <Navigate to={`/auth/sign-in?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // Check onboarding
  if (status.needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  // Check payment: admins go to start-trial, others to pending
  if (status.needsPayment) {
    return <Navigate to={status.isAdmin ? '/onboarding/start-trial' : '/onboarding/pending'} replace />;
  }

  // All checks passed, render the protected content
  return <>{children}</>;
}
