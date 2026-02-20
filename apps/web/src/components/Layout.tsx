import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Home,
  CreditCard,
  Key,
  Users,
  UsersRound,
  Settings,
  LogOut,
  Cloud,
  Shield,
  Activity,
  Lock,
} from 'lucide-react';
import { API_BASE, BEARER_TOKEN_KEY, getAuthHeaders } from '../lib/api';
import { authClient } from '../lib/auth-client';

export function Layout() {
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem(BEARER_TOKEN_KEY);
  const { data: me } = useQuery<{ user: { id: string; email: string; name: string | null; image: string | null; role?: string } }>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
    enabled: hasToken,
  });
  const profileUser = (session?.user && (session.user as { role?: string }).role) ? session.user : me?.user ?? session?.user;
  const isAdminOrManager = !!profileUser && 'role' in profileUser && (profileUser.role === 'admin' || profileUser.role === 'manager');
  const isAdmin = !!profileUser && 'role' in profileUser && profileUser.role === 'admin';

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    ...(isAdminOrManager ? [{ path: '/keys', label: 'Keys', icon: Key }] : []),
    ...(isAdminOrManager ? [{ path: '/ai-gateway', label: 'AI Gateway', icon: Cloud }] : []),
    ...(isAdmin ? [{ path: '/provider-keys', label: 'Provider Keys', icon: Lock }] : []),
    ...(isAdminOrManager ? [{ path: '/dlp', label: 'DLP', icon: Shield }] : []),
    ...(isAdminOrManager ? [{ path: '/teams', label: 'Teams', icon: UsersRound }] : []),
    { path: '/users', label: 'Users', icon: Users },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/billing', label: 'Billing', icon: CreditCard },
  ];

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div style={{ marginBottom: '40px' }}>
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              textDecoration: 'none',
              color: 'var(--dark)',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden',
              }}
            >
              <img
                src="/logo.png"
                alt=""
                style={{
                  width: '130%',
                  height: '130%',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
            <span style={{ fontSize: '20px', fontWeight: 800 }}>Stereos</span>
          </Link>
        </div>

        <nav
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginLeft: -24,
            marginRight: -24,
            width: 'calc(100% + 48px)',
          }}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || 
              (item.path !== '/' && location.pathname.startsWith(item.path));
            
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {profileUser && (
            <div
              className="sidebar-footer"
              style={{
                marginLeft: -24,
                marginRight: -24,
                marginBottom: -32,
                width: 'calc(100% + 48px)',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-cream)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(BEARER_TOKEN_KEY);
                  authClient.signOut();
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '14px 24px',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--dark)',
                  background: 'var(--bg-cream)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-mint)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-cream)';
                }}
              >
                <LogOut size={20} />
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        {profileUser && (
          <Link
            to="/settings"
            className="profile-widget"
            style={{
              position: 'fixed',
              top: 24,
              right: 24,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 18px',
              background: 'var(--bg-white)',
              border: '1px solid var(--border-default)',
              borderRadius: '12px',
              boxShadow: 'var(--shadow-md)',
              textDecoration: 'none',
              color: 'var(--dark)',
              zIndex: 50,
              transition: 'box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'var(--dark)',
                border: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {profileUser.image ? (
                <img
                  src={profileUser.image}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'white' }}>
                  {(profileUser.name ?? profileUser.email ?? '?').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.2 }}>
                {profileUser.name || 'Account'}
              </div>
              <div style={{ fontSize: '12px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                {profileUser.email}
              </div>
            </div>
          </Link>
        )}
        <Outlet />
      </main>
    </div>
  );
}
