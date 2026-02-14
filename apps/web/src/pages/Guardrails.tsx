import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Shield, ShieldPlus, X } from 'lucide-react';

interface Guardrail {
  id: string;
  name: string;
  description: string | null;
  limit_usd: number | null;
  reset_interval: 'daily' | 'weekly' | 'monthly' | null;
  created_at: string;
}

interface KeyItem {
  id: string;
  openrouter_key_hash: string;
  name: string;
}

export function Guardrails() {
  const queryClient = useQueryClient();
  const [modalType, setModalType] = useState<'create' | 'assign' | null>(null);
  const [guardrailName, setGuardrailName] = useState('');
  const [guardrailDesc, setGuardrailDesc] = useState('');
  const [guardrailLimit, setGuardrailLimit] = useState('');
  const [guardrailReset, setGuardrailReset] = useState<'daily' | 'weekly' | 'monthly' | ''>('');
  const [assignGuardrailId, setAssignGuardrailId] = useState('');
  const [selectedKeyHashes, setSelectedKeyHashes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const { data: guardrailsData, isLoading } = useQuery<{ data: Guardrail[]; total_count: number }>({
    queryKey: ['guardrails'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/guardrails`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch guardrails');
      return res.json();
    },
    enabled: isAdminOrManager,
  });

  const { data: keysData } = useQuery<{ keys: KeyItem[] }>({
    queryKey: ['keys-customer'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/keys/customer`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch keys');
      return res.json();
    },
    enabled: isAdminOrManager && modalType === 'assign',
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
        <p style={{ color: '#555' }}>Loading guardrails…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const guardrails = guardrailsData?.data ?? [];
  const keys = keysData?.keys ?? [];

  const openCreateModal = () => {
    setModalType('create');
    setGuardrailName('');
    setGuardrailDesc('');
    setGuardrailLimit('');
    setGuardrailReset('');
    setError('');
  };

  const openAssignModal = () => {
    setModalType('assign');
    setAssignGuardrailId('');
    setSelectedKeyHashes(new Set());
    setError('');
  };

  const createGuardrail = async () => {
    if (!guardrailName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/v1/guardrails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          name: guardrailName.trim(),
          description: guardrailDesc.trim() || null,
          limit_usd: guardrailLimit ? parseFloat(guardrailLimit) : null,
          reset_interval: guardrailReset || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create guardrail');
      setModalType(null);
      queryClient.invalidateQueries({ queryKey: ['guardrails'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create guardrail');
    } finally {
      setLoading(false);
    }
  };

  const assignKeys = async () => {
    if (!assignGuardrailId || selectedKeyHashes.size === 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/v1/guardrails/${assignGuardrailId}/assignments/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ key_hashes: Array.from(selectedKeyHashes) }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to assign keys');
      setModalType(null);
      queryClient.invalidateQueries({ queryKey: ['guardrails'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign keys');
    } finally {
      setLoading(false);
    }
  };

  const toggleKeySelection = (hash: string) => {
    setSelectedKeyHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 className="heading-1" style={{ marginBottom: '8px' }}>
          Guardrails
        </h1>
        <p style={{ color: '#555', fontSize: '16px' }}>
          Guardrails limit which models and providers API keys can use. Assign keys to guardrails to enforce usage policies.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={openCreateModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldPlus size={18} />
          Create guardrail
        </button>
        <button type="button" className="btn btn-primary" onClick={openAssignModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          Assign keys to guardrail
        </button>
        <Link to="/keys" className="btn" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          Manage keys →
        </Link>
      </div>

      <div className="card">
        <h2 className="heading-3" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={20} />
          All guardrails
        </h2>
        {guardrails.length === 0 ? (
          <p style={{ color: '#555', textAlign: 'center', padding: '32px' }}>
            No guardrails yet. Create one to limit which models and providers keys can use.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {guardrails.map((g) => (
              <div
                key={g.id}
                style={{
                  padding: '16px',
                  background: 'var(--bg-cream)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '8px',
                }}
              >
                <p style={{ margin: 0, fontWeight: 600, fontSize: '16px' }}>{g.name}</p>
                {g.description && <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#555' }}>{g.description}</p>}
                <div style={{ marginTop: '8px', display: 'flex', gap: '16px', fontSize: '13px', color: '#666' }}>
                  {g.limit_usd != null && <span>Limit: ${g.limit_usd}/{(g.reset_interval ?? 'month')}</span>}
                  {g.reset_interval && <span>Reset: {g.reset_interval}</span>}
                  <span>Created {new Date(g.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalType === 'create' && (
        <CreateGuardrailModal
          guardrailName={guardrailName}
          setGuardrailName={setGuardrailName}
          guardrailDesc={guardrailDesc}
          setGuardrailDesc={setGuardrailDesc}
          guardrailLimit={guardrailLimit}
          setGuardrailLimit={setGuardrailLimit}
          guardrailReset={guardrailReset}
          setGuardrailReset={setGuardrailReset}
          loading={loading}
          error={error}
          onClose={() => setModalType(null)}
          onCreate={createGuardrail}
          canCreate={!!guardrailName.trim()}
        />
      )}

      {modalType === 'assign' && (
        <AssignKeysModal
          guardrails={guardrails}
          keys={keys}
          assignGuardrailId={assignGuardrailId}
          setAssignGuardrailId={setAssignGuardrailId}
          selectedKeyHashes={selectedKeyHashes}
          toggleKeySelection={toggleKeySelection}
          loading={loading}
          error={error}
          onClose={() => setModalType(null)}
          onAssign={assignKeys}
          canAssign={!!(assignGuardrailId && selectedKeyHashes.size > 0)}
        />
      )}
    </div>
  );
}

function CreateGuardrailModal({
  guardrailName,
  setGuardrailName,
  guardrailDesc,
  setGuardrailDesc,
  guardrailLimit,
  setGuardrailLimit,
  guardrailReset,
  setGuardrailReset,
  loading,
  error,
  onClose,
  onCreate,
  canCreate,
}: {
  guardrailName: string;
  setGuardrailName: (v: string) => void;
  guardrailDesc: string;
  setGuardrailDesc: (v: string) => void;
  guardrailLimit: string;
  setGuardrailLimit: (v: string) => void;
  guardrailReset: string;
  setGuardrailReset: (v: 'daily' | 'weekly' | 'monthly' | '') => void;
  loading: boolean;
  error: string;
  onClose: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
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
        style={{ maxWidth: '440px', width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h2 className="heading-3" style={{ margin: 0 }}>Create guardrail</h2>
            <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#555' }}>
              Guardrails limit which models and providers assigned keys can use.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#666' }}>
            <X size={24} />
          </button>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Name</label>
          <input
            type="text"
            className="input"
            value={guardrailName}
            onChange={(e) => setGuardrailName(e.target.value)}
            placeholder="e.g. Production, Dev sandbox"
            disabled={loading}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Description (optional)</label>
          <input
            type="text"
            className="input"
            value={guardrailDesc}
            onChange={(e) => setGuardrailDesc(e.target.value)}
            placeholder="What this guardrail enforces"
            disabled={loading}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Limit (USD, optional)</label>
          <input
            type="number"
            className="input"
            value={guardrailLimit}
            onChange={(e) => setGuardrailLimit(e.target.value)}
            placeholder="e.g. 100"
            min="0"
            step="0.01"
            disabled={loading}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Reset interval (optional)</label>
          <select
            className="input"
            value={guardrailReset}
            onChange={(e) => setGuardrailReset(e.target.value as 'daily' | 'weekly' | 'monthly' | '')}
            disabled={loading}
            style={{ width: '100%' }}
          >
            <option value="">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {error && <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: '12px', fontSize: '14px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-primary" disabled={loading || !canCreate} onClick={onCreate}>
            {loading ? 'Creating…' : 'Create'}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={loading}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AssignKeysModal({
  guardrails,
  keys,
  assignGuardrailId,
  setAssignGuardrailId,
  selectedKeyHashes,
  toggleKeySelection,
  loading,
  error,
  onClose,
  onAssign,
  canAssign,
}: {
  guardrails: Guardrail[];
  keys: KeyItem[];
  assignGuardrailId: string;
  setAssignGuardrailId: (v: string) => void;
  selectedKeyHashes: Set<string>;
  toggleKeySelection: (hash: string) => void;
  loading: boolean;
  error: string;
  onClose: () => void;
  onAssign: () => void;
  canAssign: boolean;
}) {
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
            <h2 className="heading-3" style={{ margin: 0 }}>Assign keys to guardrail</h2>
            <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#555' }}>
              Select a guardrail and keys to assign. Assigned keys will be subject to the guardrail&apos;s limits.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#666' }}>
            <X size={24} />
          </button>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Guardrail</label>
          <select
            className="input"
            value={assignGuardrailId}
            onChange={(e) => setAssignGuardrailId(e.target.value)}
            disabled={loading}
            style={{ width: '100%' }}
          >
            <option value="">Select a guardrail…</option>
            {guardrails.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Keys to assign</label>
          {keys.length === 0 ? (
            <p style={{ color: '#555', fontSize: '14px' }}>No keys available. <Link to="/keys" onClick={onClose}>Provision keys</Link> first.</p>
          ) : (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px' }}>
              {keys.map((k) => (
                <label
                  key={k.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedKeyHashes.has(k.openrouter_key_hash)}
                    onChange={() => toggleKeySelection(k.openrouter_key_hash)}
                  />
                  <span style={{ fontWeight: 500 }}>{k.name}</span>
                  <span style={{ fontSize: '12px', color: '#666', fontFamily: 'monospace' }}>{k.openrouter_key_hash.slice(0, 12)}…</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: '12px', fontSize: '14px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-primary" disabled={loading || !canAssign} onClick={onAssign}>
            {loading ? 'Assigning…' : 'Assign'}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={loading}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
