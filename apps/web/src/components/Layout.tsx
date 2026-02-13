import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Home,
  Funnel,
  Users,
  UsersRound,
  Settings,
  LogOut,
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
  const isAdmin = !!profileUser && 'role' in profileUser && profileUser.role === 'admin';

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/ingest', label: 'Ingestion', icon: Funnel },
    ...(isAdmin ? [{ path: '/teams', label: 'Teams', icon: UsersRound }] : []),
    { path: '/users', label: 'Users', icon: Users },
    { path: '/settings', label: 'Settings', icon: Settings },
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
                border: '3px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '4px 4px 0 var(--border-color)',
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
            <span style={{ fontSize: '24px', fontWeight: 800 }}>STEREOS</span>
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
                borderTop: '3px solid var(--border-color)',
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
              border: '2px solid var(--border-color)',
              borderRadius: '16px',
              boxShadow: '4px 4px 0 var(--border-color)',
              textDecoration: 'none',
              color: 'var(--dark)',
              zIndex: 50,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translate(-2px, -2px)';
              e.currentTarget.style.boxShadow = '6px 6px 0 var(--border-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translate(0, 0)';
              e.currentTarget.style.boxShadow = '4px 4px 0 var(--border-color)';
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'var(--dark)',
                border: '2px solid var(--border-color)',
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
