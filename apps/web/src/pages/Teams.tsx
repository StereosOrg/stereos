import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { analytics } from '../lib/customerio';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

interface Team {
  id: string;
  name: string;
  profile_pic: string | null;
  archived_at?: string | null;
}

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export function Teams() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const { data: teamsData, isLoading } = useQuery<{ teams: Team[] }>({
    queryKey: ['teams', showArchived],
    queryFn: async () => {
      const url = showArchived ? `${API_BASE}/v1/teams?include_archived=1` : `${API_BASE}/v1/teams`;
      const res = await fetch(url, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch teams');
      return res.json();
    },
  });

  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/users`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [profilePic, setProfilePic] = useState('');
  const [managerId, setManagerId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [unarchiving, setUnarchiving] = useState<string | null>(null);

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/v1/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ name, profile_pic: profilePic || null, manager_user_id: managerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create team');
      const manager = usersData?.users.find((u) => u.id === managerId);
      analytics.track('Team Created', {
        team_name: name,
        manager_user_id: managerId || null,
        manager_name: manager?.name || manager?.email || null,
      });
      setName('');
      setProfilePic('');
      setManagerId('');
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setSaving(false);
    }
  };

  const deleteTeam = async (teamId: string, teamName: string) => {
    const confirmed = window.confirm(`Archive team "${teamName}"? You can’t use it after archiving.`);
    if (!confirmed) return;
    setError('');
    setDeleting(teamId);
    try {
      const res = await fetch(`${API_BASE}/v1/teams/${teamId}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to archive team');
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive team');
    } finally {
      setDeleting(null);
    }
  };

  const unarchiveTeam = async (teamId: string, teamName: string) => {
    const confirmed = window.confirm(`Unarchive team "${teamName}"?`);
    if (!confirmed) return;
    setError('');
    setUnarchiving(teamId);
    try {
      const res = await fetch(`${API_BASE}/v1/teams/${teamId}/unarchive`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to unarchive team');
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive team');
    } finally {
      setUnarchiving(null);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '2px solid var(--border-default)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
      </div>
    );
  }

  const teams = teamsData?.teams ?? [];
  const managers = (usersData?.users ?? []).filter((u) => u.role === 'manager' || u.role === 'admin');

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h1 className="heading-1" style={{ margin: 0 }}>Teams</h1>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Create team
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '8px 0 0' }}>
          <p className="text-large" style={{ color: '#555', margin: 0 }}>{teams.length} teams</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: '24px', maxWidth: '520px' }}>
          <h2 className="heading-3" style={{ marginBottom: '12px' }}>New team</h2>
          <form onSubmit={createTeam}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Profile pic (optional)</label>
              <input className="input" value={profilePic} onChange={(e) => setProfilePic(e.target.value)} placeholder="https://..." />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Manager</label>
              <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)} required>
                <option value="">Select manager</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
            </div>
            {error && <p style={{ color: '#dc2626', fontSize: '14px', fontWeight: 600 }}>{error}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
              <button className="btn" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-mint)', borderBottom: 'var(--border-width) solid var(--border-color)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Team</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} style={{ borderBottom: 'var(--border-width) solid var(--border-color)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span>{t.name}</span>
                    {t.archived_at && (
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Archived</span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '8px' }}>
                    <Link to={`/teams/${t.id}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>View</Link>
                    {t.archived_at ? (
                      <button className="btn" type="button" onClick={() => unarchiveTeam(t.id, t.name)} disabled={unarchiving === t.id}>
                        {unarchiving === t.id ? 'Unarchiving…' : 'Unarchive'}
                      </button>
                    ) : (
                      <button className="btn" type="button" onClick={() => deleteTeam(t.id, t.name)} disabled={deleting === t.id}>
                        {deleting === t.id ? 'Archiving…' : 'Archive'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
