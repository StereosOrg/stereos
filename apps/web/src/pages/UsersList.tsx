import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { API_BASE } from '../lib/api';
import { UserPlus } from 'lucide-react';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  image: string | null;
}

export function UsersList() {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const { data: users, isLoading, error } = useQuery<{ users: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/v1/users`, {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Admin access required');
        }
        throw new Error('Failed to fetch users');
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '3px solid var(--border-color)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ color: '#555' }}>Loading users…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="card"
        style={{
          background: 'var(--bg-pink)',
          border: '3px solid #dc2626',
          padding: '24px',
        }}
      >
        <h2 className="heading-3" style={{ marginBottom: '8px', color: '#991b1b' }}>
          Access denied
        </h2>
        <p style={{ color: '#555' }}>
          You need admin privileges to view this page.
        </p>
      </div>
    );
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setInviteSuccess(false);
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send invite');
      setInviteSuccess(true);
      setInviteEmail('');
      setShowInvite(false);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <h1 className="heading-1" style={{ margin: 0 }}>
            Users
          </h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setShowInvite(true); setInviteError(''); setInviteSuccess(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <UserPlus size={20} />
            Invite member
          </button>
        </div>
        <p className="text-large" style={{ color: '#555', margin: 0 }}>
          {users?.users.length ?? 0} total users
        </p>
      </div>

      {inviteSuccess && (
        <div className="card" style={{ marginBottom: '24px', background: 'var(--bg-mint)', border: '3px solid var(--border-color)' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Invite sent. They’ll receive an email with a link to join the workspace.</p>
        </div>
      )}

      {showInvite && (
        <div className="card" style={{ marginBottom: '24px', maxWidth: '420px' }}>
          <h2 className="heading-3" style={{ marginBottom: '12px' }}>Invite to workspace</h2>
          <p style={{ color: '#555', fontSize: '14px', marginBottom: '16px' }}>
            Enter their email. They’ll get a link to create an account and join this workspace.
          </p>
          <form onSubmit={handleInvite}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Email</label>
              <input
                type="email"
                className="input"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                disabled={inviteLoading}
                required
                style={{ width: '100%' }}
              />
            </div>
            {inviteError && (
              <p style={{ color: '#dc2626', fontSize: '14px', marginBottom: '12px', fontWeight: 600 }}>{inviteError}</p>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-primary" disabled={inviteLoading}>
                {inviteLoading ? 'Sending…' : 'Send invite'}
              </button>
              <button type="button" className="btn" onClick={() => { setShowInvite(false); setInviteError(''); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div
        className="card"
        style={{
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{
                background: 'var(--bg-mint)',
                borderBottom: 'var(--border-width) solid var(--border-color)',
              }}
            >
              <th
                style={{
                  padding: '16px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--dark)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                User
              </th>
              <th
                style={{
                  padding: '16px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--dark)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Role
              </th>
              <th
                style={{
                  padding: '16px 24px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--dark)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Joined
              </th>
              <th
                style={{
                  padding: '16px 24px',
                  textAlign: 'right',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--dark)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users?.users.map((user) => (
              <tr
                key={user.id}
                style={{
                  borderBottom: 'var(--border-width) solid var(--border-color)',
                  background: 'var(--bg-white)',
                }}
              >
                <td style={{ padding: '16px 24px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                    }}
                  >
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '8px',
                        background: 'var(--dark)',
                        border: '2px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '18px',
                        fontWeight: 700,
                        color: 'white',
                      }}
                    >
                      {user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, margin: 0 }}>
                        {user.name || 'Unnamed User'}
                      </p>
                      <p style={{ fontSize: '14px', color: '#555', margin: '2px 0 0' }}>
                        {user.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '16px 24px' }}>
                  <span
                    className="badge"
                    style={{
                      background:
                        user.role === 'admin'
                          ? 'var(--dark)'
                          : 'var(--bg-lavender)',
                      color: user.role === 'admin' ? 'white' : 'var(--dark)',
                    }}
                  >
                    {user.role}
                  </span>
                </td>
                <td style={{ padding: '16px 24px', color: '#555' }}>
                  {new Date(user.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                  <Link
                    to={`/users/${user.id}`}
                    className="btn btn-primary"
                    style={{
                      padding: '8px 16px',
                      fontSize: '14px',
                      textDecoration: 'none',
                    }}
                  >
                    View profile
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
