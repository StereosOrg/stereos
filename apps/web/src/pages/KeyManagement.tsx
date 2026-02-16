import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { posthog } from '../lib/posthog';
import { Key, UserPlus, UsersRound, X, Trash2 } from 'lucide-react';

const OPENAI_LOGO = 'https://images.seeklogo.com/logo-png/42/2/open-ai-logo-png_seeklogo-428036.png';
const ANTHROPIC_LOGO = 'https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/1/anthropic-icon-wii9u8ifrjrd99btrqfgi.png/anthropic-icon-tdvkiqisswbrmtkiygb0ia.png';

function getModelLogo(model: string): string {
  if (model.startsWith('claude')) return ANTHROPIC_LOGO;
  return OPENAI_LOGO;
}

interface KeyItem {
  id: string;
  key_hash: string;
  name: string;
  user_id: string | null;
  team_id: string | null;
  user_email: string | null;
  user_name: string | null;
  team_name: string | null;
  budget_usd: number | null;
  spend_usd: number;
  budget_reset: string | null;
  created_at: string;
  disabled: boolean;
  allowed_models: string[] | null;
}

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface Team {
  id: string;
  name: string;
}

export function KeyManagement() {
  const queryClient = useQueryClient();
  const [modalType, setModalType] = useState<'user' | 'team' | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [keyName, setKeyName] = useState('');
  const [budgetUsd, setBudgetUsd] = useState<string>('');
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdKeyRaw, setCreatedKeyRaw] = useState<string | null>(null);

  const { data: me } = useQuery<{ user: { id: string; role?: string } }>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
  });

  const isAdminOrManager = me?.user?.role === 'admin' || me?.user?.role === 'manager';
  const meLoaded = me !== undefined;

  const { data: customerData } = useQuery<{ customer: { id: string } }>({
    queryKey: ['customers-me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/customers/me`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch customer');
      return res.json();
    },
    enabled: isAdminOrManager && modalType === 'user',
  });

  const { data: usersData } = useQuery<{ users: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/users`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    },
    enabled: isAdminOrManager && modalType === 'user',
  });

  const { data: teamsData } = useQuery<{ teams: Team[] }>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/teams`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch teams');
      return res.json();
    },
    enabled: isAdminOrManager && modalType === 'team',
  });

  const { data: modelsData } = useQuery<{ models: string[] }>({
    queryKey: ['ai-models'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/models`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch models');
      return res.json();
    },
    enabled: isAdminOrManager,
  });

  const { data, isLoading, error } = useQuery<{ keys: KeyItem[] }>({
    queryKey: ['keys-customer'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/ai/keys/customer`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin or manager access required');
        throw new Error('Failed to fetch keys');
      }
      return res.json();
    },
    enabled: isAdminOrManager,
  });

  if (meLoaded && !isAdminOrManager) {
    return <Navigate to="/settings" replace />;
  }

  if (!meLoaded || (isLoading && isAdminOrManager)) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '2px solid var(--border-default)',
            borderTopColor: 'var(--bg-mint)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ color: '#555' }}>Loading keys…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: '24px' }}>
        <p style={{ color: '#dc2626', fontWeight: 600 }}>{error instanceof Error ? error.message : 'Failed to load keys'}</p>
        <Link to="/settings" className="btn" style={{ marginTop: '16px', display: 'inline-block' }}>
          Back to settings
        </Link>
      </div>
    );
  }

  const keys = data?.keys ?? [];
  const totalMonthlySpend = keys.reduce((sum, k) => sum + parseFloat(String(k.spend_usd ?? '0')), 0);
  const models = modelsData?.models ?? [];
  const users = usersData?.users ?? [];
  const teams = teamsData?.teams ?? [];
  const customerId = customerData?.customer?.id;

  const openUserModal = () => {
    setModalType('user');
    setSelectedUserId('');
    setKeyName('');
    setBudgetUsd('');
    setAllowedModels([]);
    setCreateError('');
    setCreatedKeyRaw(null);
  };

  const openTeamModal = () => {
    setModalType('team');
    setSelectedTeamId('');
    setKeyName('');
    setBudgetUsd('');
    setAllowedModels([]);
    setCreateError('');
    setCreatedKeyRaw(null);
  };

  const closeModal = () => {
    setModalType(null);
    setKeyName('');
    setBudgetUsd('');
    setAllowedModels([]);
    setCreateError('');
    setCreatedKeyRaw(null);
  };

  const createUserKey = async () => {
    if (!selectedUserId || !keyName.trim() || !customerId) return;
    setCreatingKey(true);
    setCreateError('');
    setCreatedKeyRaw(null);
    try {
      const body: Record<string, unknown> = {
        name: keyName.trim(),
        customer_id: customerId,
        user_id: selectedUserId,
      };
      if (budgetUsd) body.budget_usd = budgetUsd;
      if (allowedModels.length > 0) body.allowed_models = allowedModels;

      const res = await fetch(`${API_BASE}/v1/ai/keys/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create key');
      const selectedUser = users.find((u) => u.id === selectedUserId);
      posthog.capture('Key Created', {
        type: 'user',
        key_name: keyName.trim(),
        user_id: selectedUserId,
        user_email: selectedUser?.email,
        user_name: selectedUser?.name,
      });
      setCreatedKeyRaw(result.key ?? null);
      setKeyName('');
      setBudgetUsd('');
      setAllowedModels([]);
      setSelectedUserId('');
      queryClient.invalidateQueries({ queryKey: ['keys-customer'] });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreatingKey(false);
    }
  };

  const deleteKey = async (hash: string) => {
    if (!confirm('Delete this key? It will stop working immediately.')) return;
    try {
      const res = await fetch(`${API_BASE}/v1/ai/keys/${encodeURIComponent(hash)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete key');
      queryClient.invalidateQueries({ queryKey: ['keys-customer'] });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete key');
    }
  };

  const createTeamKey = async () => {
    if (!selectedTeamId || !keyName.trim()) return;
    setCreatingKey(true);
    setCreateError('');
    setCreatedKeyRaw(null);
    try {
      const body: Record<string, unknown> = {
        name: keyName.trim(),
        customer_id: customerId,
      };
      if (budgetUsd) body.budget_usd = budgetUsd;
      if (allowedModels.length > 0) body.allowed_models = allowedModels;

      const res = await fetch(`${API_BASE}/v1/ai/keys/team/${selectedTeamId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create key');
      const selectedTeam = teams.find((t) => t.id === selectedTeamId);
      posthog.capture('Key Created', {
        type: 'team',
        key_name: keyName.trim(),
        team_id: selectedTeamId,
        team_name: selectedTeam?.name,
      });
      setCreatedKeyRaw(result.key ?? null);
      setKeyName('');
      setBudgetUsd('');
      setAllowedModels([]);
      setSelectedTeamId('');
      queryClient.invalidateQueries({ queryKey: ['keys-customer'] });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreatingKey(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 className="heading-1" style={{ marginBottom: '8px' }}>
          Key provisioning
        </h1>
        <p style={{ color: '#555', fontSize: '16px' }}>
          Manage AI inference keys for users and teams. Keys are used in agents or the VS Code extension for LLM access.
        </p>
      </div>

      {/* Quick actions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        <button
          type="button"
          className="card"
          onClick={openUserModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '20px',
            border: '1px solid var(--border-default)',
            transition: 'box-shadow 0.15s ease',
            cursor: 'pointer',
            textAlign: 'left',
            background: 'var(--bg-white)',
            width: '100%',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              background: 'var(--bg-mint)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UserPlus size={24} />
          </div>
          <div>
            <h3 className="heading-3" style={{ margin: 0, fontSize: '16px' }}>Provision for user</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>Create keys for users</p>
          </div>
        </button>
        <button
          type="button"
          className="card"
          onClick={openTeamModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '20px',
            border: '1px solid var(--border-default)',
            transition: 'box-shadow 0.15s ease',
            cursor: 'pointer',
            textAlign: 'left',
            background: 'var(--bg-white)',
            width: '100%',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              background: 'var(--bg-lavender)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UsersRound size={24} />
          </div>
          <div>
            <h3 className="heading-3" style={{ margin: 0, fontSize: '16px' }}>Provision for team</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>Create keys for teams</p>
          </div>
        </button>
      </div>

      {/* Provision modals */}
      {modalType === 'user' && (
        <ProvisionUserModal
          users={users}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
          keyName={keyName}
          setKeyName={setKeyName}
          budgetUsd={budgetUsd}
          setBudgetUsd={setBudgetUsd}
          allowedModels={allowedModels}
          setAllowedModels={setAllowedModels}
          models={models}
          creatingKey={creatingKey}
          createError={createError}
          createdKeyRaw={createdKeyRaw}
          onClose={closeModal}
          onCreate={createUserKey}
          canCreate={!!(selectedUserId && keyName.trim() && customerId)}
        />
      )}
      {modalType === 'team' && (
        <ProvisionTeamModal
          teams={teams}
          selectedTeamId={selectedTeamId}
          setSelectedTeamId={setSelectedTeamId}
          keyName={keyName}
          setKeyName={setKeyName}
          budgetUsd={budgetUsd}
          setBudgetUsd={setBudgetUsd}
          allowedModels={allowedModels}
          setAllowedModels={setAllowedModels}
          models={models}
          creatingKey={creatingKey}
          createError={createError}
          createdKeyRaw={createdKeyRaw}
          onClose={closeModal}
          onCreate={createTeamKey}
          canCreate={!!(selectedTeamId && keyName.trim())}
        />
      )}

      {/* Summary */}
      {keys.length > 0 && (
        <div style={{ marginBottom: '24px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          <div
            className="card"
            style={{
              padding: '16px 24px',
              background: 'var(--bg-mint)',
              border: '1px solid var(--border-default)',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total keys
            </span>
            <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700 }}>{keys.length}</p>
          </div>
          <div
            className="card"
            style={{
              padding: '16px 24px',
              background: 'var(--bg-cream)',
              border: '1px solid var(--border-default)',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Monthly spend
            </span>
            <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700 }}>${totalMonthlySpend.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Keys table */}
      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key size={20} />
          All keys
        </h2>
        {keys.length === 0 ? (
          <p style={{ color: '#555', textAlign: 'center', padding: '32px' }}>
            No keys yet. Provision keys from a user profile or team page.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-default)' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase' }}>Scope</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase' }}>Usage</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase' }}>Created</th>
                  <th style={{ width: '80px' }} />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <Link
                        to={`/keys/${k.key_hash}`}
                        style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}
                      >
                        {k.name}
                      </Link>
                      <div style={{ fontSize: '12px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                        {k.key_hash.slice(0, 16)}…
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '14px' }}>
                      {k.team_id ? (
                        <Link to={`/teams/${k.team_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          {k.team_name ?? 'Team'}
                        </Link>
                      ) : k.user_id ? (
                        <Link to={`/users/${k.user_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          {(k.user_name || k.user_email) ?? 'User'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '14px' }}>
                      <div>${parseFloat(String(k.spend_usd ?? '0')).toFixed(2)}</div>
                      {k.budget_usd != null && (
                        <div style={{ fontSize: '11px', color: '#666' }}>
                          of ${parseFloat(String(k.budget_usd)).toFixed(2)} budget
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        className="badge"
                        style={{
                          background: k.disabled ? 'var(--bg-pink)' : 'var(--accent-green)',
                          color: k.disabled ? '#991b1b' : 'var(--dark)',
                          fontSize: '11px',
                        }}
                      >
                        {k.disabled ? 'Disabled' : 'Active'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '13px', color: '#666' }}>
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => deleteKey(k.key_hash)}
                        style={{ color: '#dc2626', padding: '6px 10px' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ProvisionUserModal({
  users,
  selectedUserId,
  setSelectedUserId,
  keyName,
  setKeyName,
  budgetUsd,
  setBudgetUsd,
  allowedModels,
  setAllowedModels,
  models,
  creatingKey,
  createError,
  createdKeyRaw,
  onClose,
  onCreate,
  canCreate,
}: {
  users: User[];
  selectedUserId: string;
  setSelectedUserId: (v: string) => void;
  keyName: string;
  setKeyName: (v: string) => void;
  budgetUsd: string;
  setBudgetUsd: (v: string) => void;
  allowedModels: string[];
  setAllowedModels: (v: string[]) => void;
  models: string[];
  creatingKey: boolean;
  createError: string;
  createdKeyRaw: string | null;
  onClose: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const toggleModel = (model: string) => {
    if (allowedModels.includes(model)) {
      setAllowedModels(allowedModels.filter((m) => m !== model));
    } else {
      setAllowedModels([...allowedModels, model]);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: '480px', width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h2 className="heading-3" style={{ margin: 0 }}>Provision key for user</h2>
            <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#555' }}>
              Create an AI inference key for a user. They will see it in Settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#666' }}
          >
            <X size={24} />
          </button>
        </div>

        {createdKeyRaw ? (
          <div style={{ padding: '16px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', borderRadius: '8px' }}>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>Key created — copy and share it with the user. It won&apos;t be shown again.</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '13px' }}>{createdKeyRaw}</code>
              <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(createdKeyRaw)}>Copy</button>
              <button type="button" className="btn" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>User</label>
              <select
                className="input"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={creatingKey}
                style={{ width: '100%' }}
              >
                <option value="">Select a user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Key name</label>
              <input
                type="text"
                className="input"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Cursor, CLI"
                disabled={creatingKey}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                Budget (USD) <span style={{ fontWeight: 400, color: '#666' }}>— optional</span>
              </label>
              <input
                type="number"
                className="input"
                value={budgetUsd}
                onChange={(e) => setBudgetUsd(e.target.value)}
                placeholder="e.g. 100"
                disabled={creatingKey}
                style={{ width: '100%' }}
                min="0"
                step="0.01"
              />
            </div>
            {models.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                  Allowed models <span style={{ fontWeight: 400, color: '#666' }}>— optional (leave empty for all)</span>
                </label>
                <div style={{ maxHeight: '150px', overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px' }}>
                  {models.map((model) => (
                    <label key={model} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allowedModels.includes(model)}
                        onChange={() => toggleModel(model)}
                        disabled={creatingKey}
                      />
                      <img src={getModelLogo(model)} alt="" style={{ width: '16px', height: '16px', borderRadius: '3px', objectFit: 'contain' }} />
                      <span style={{ fontSize: '13px' }}>{model}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {createError && <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: '12px', fontSize: '14px' }}>{createError}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" disabled={creatingKey || !canCreate} onClick={onCreate}>
                {creatingKey ? 'Creating…' : 'Create key'}
              </button>
              <button type="button" className="btn" onClick={onClose} disabled={creatingKey}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProvisionTeamModal({
  teams,
  selectedTeamId,
  setSelectedTeamId,
  keyName,
  setKeyName,
  budgetUsd,
  setBudgetUsd,
  allowedModels,
  setAllowedModels,
  models,
  creatingKey,
  createError,
  createdKeyRaw,
  onClose,
  onCreate,
  canCreate,
}: {
  teams: Team[];
  selectedTeamId: string;
  setSelectedTeamId: (v: string) => void;
  keyName: string;
  setKeyName: (v: string) => void;
  budgetUsd: string;
  setBudgetUsd: (v: string) => void;
  allowedModels: string[];
  setAllowedModels: (v: string[]) => void;
  models: string[];
  creatingKey: boolean;
  createError: string;
  createdKeyRaw: string | null;
  onClose: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const toggleModel = (model: string) => {
    if (allowedModels.includes(model)) {
      setAllowedModels(allowedModels.filter((m) => m !== model));
    } else {
      setAllowedModels([...allowedModels, model]);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: '480px', width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h2 className="heading-3" style={{ margin: 0 }}>Provision key for team</h2>
            <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#555' }}>
              Create an AI inference key for a team. Team members will see it in Settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#666' }}
          >
            <X size={24} />
          </button>
        </div>

        {createdKeyRaw ? (
          <div style={{ padding: '16px', background: 'var(--bg-mint)', border: '1px solid var(--border-default)', borderRadius: '8px' }}>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>Key created — copy and share it with the team. It won&apos;t be shown again.</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '13px' }}>{createdKeyRaw}</code>
              <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(createdKeyRaw)}>Copy</button>
              <button type="button" className="btn" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Team</label>
              <select
                className="input"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                disabled={creatingKey}
                style={{ width: '100%' }}
              >
                <option value="">Select a team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Key name</label>
              <input
                type="text"
                className="input"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Cursor, CLI"
                disabled={creatingKey}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                Budget (USD) <span style={{ fontWeight: 400, color: '#666' }}>— optional</span>
              </label>
              <input
                type="number"
                className="input"
                value={budgetUsd}
                onChange={(e) => setBudgetUsd(e.target.value)}
                placeholder="e.g. 100"
                disabled={creatingKey}
                style={{ width: '100%' }}
                min="0"
                step="0.01"
              />
            </div>
            {models.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                  Allowed models <span style={{ fontWeight: 400, color: '#666' }}>— optional (leave empty for all)</span>
                </label>
                <div style={{ maxHeight: '150px', overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px' }}>
                  {models.map((model) => (
                    <label key={model} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allowedModels.includes(model)}
                        onChange={() => toggleModel(model)}
                        disabled={creatingKey}
                      />
                      <img src={getModelLogo(model)} alt="" style={{ width: '16px', height: '16px', borderRadius: '3px', objectFit: 'contain' }} />
                      <span style={{ fontSize: '13px' }}>{model}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {createError && <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: '12px', fontSize: '14px' }}>{createError}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" disabled={creatingKey || !canCreate} onClick={onCreate}>
                {creatingKey ? 'Creating…' : 'Create key'}
              </button>
              <button type="button" className="btn" onClick={onClose} disabled={creatingKey}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
