import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Shield, CheckCircle, AlertCircle } from 'lucide-react';

interface DlpConfig {
  dlp_enabled: boolean;
  dlp_action: string;
  dlp_profile_ids: string[];
}

interface DlpProfile {
  id: string;
  name: string;
  description?: string;
  type: string;
  entries: Array<{ id: string; name: string; enabled: boolean }>;
}

export function DLP() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [action, setAction] = useState<'BLOCK' | 'FLAG'>('BLOCK');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: config, isLoading: configLoading } = useQuery<DlpConfig>({
    queryKey: ['dlp-config'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/dlp/config`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status === 400) return { dlp_enabled: false, dlp_action: 'BLOCK', dlp_profile_ids: [] };
        throw new Error('Failed to fetch DLP config');
      }
      return res.json();
    },
  });

  const { data: profilesData, isLoading: profilesLoading } = useQuery<{ profiles: DlpProfile[] }>({
    queryKey: ['dlp-profiles'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/dlp/profiles`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch DLP profiles');
      return res.json();
    },
  });

  // Sync local state when config loads
  useEffect(() => {
    if (config) {
      setEnabled(config.dlp_enabled);
      setAction(config.dlp_action as 'BLOCK' | 'FLAG');
      setSelectedIds(config.dlp_profile_ids);
      setDirty(false);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/v1/dlp/config`, {
        method: 'PUT',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dlp_enabled: enabled,
          dlp_action: action,
          dlp_profile_ids: selectedIds,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to save DLP config');
      }
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      setMessage({ type: 'success', text: 'DLP configuration saved' });
      queryClient.invalidateQueries({ queryKey: ['dlp-config'] });
      setTimeout(() => setMessage(null), 3000);
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message });
    },
  });

  const toggleProfile = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
    setDirty(true);
  };

  const toggleEnabled = () => {
    setEnabled((prev) => !prev);
    setDirty(true);
  };

  const setActionAndDirty = (a: 'BLOCK' | 'FLAG') => {
    setAction(a);
    setDirty(true);
  };

  if (configLoading) {
    return (
      <div style={{ padding: '48px', maxWidth: '720px' }}>
        <p style={{ color: '#666' }}>Loading...</p>
      </div>
    );
  }

  const profiles = profilesData?.profiles ?? [];

  return (
    <div style={{ padding: '48px', maxWidth: '720px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px' }}>Data Loss Prevention</h1>
      <p style={{ color: '#666', marginBottom: '32px', fontSize: '15px' }}>
        Scan AI requests for sensitive data like credit card numbers, SSNs, and government IDs. Select which detection profiles to apply to your gateway.
      </p>

      {/* Configuration Card */}
      <div
        style={{
          padding: '24px',
          border: '1px solid var(--border-default)',
          borderRadius: '12px',
          background: 'var(--bg-white)',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <Shield size={24} />
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Configuration</h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Enable DLP</div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Scan AI requests for sensitive data patterns
            </div>
          </div>
          <button
            type="button"
            onClick={toggleEnabled}
            style={{
              width: '48px',
              height: '28px',
              borderRadius: '14px',
              border: 'none',
              background: enabled ? '#16a34a' : '#d1d5db',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <div
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: '3px',
                left: enabled ? '23px' : '3px',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Action</div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              What to do when sensitive data is detected
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['BLOCK', 'FLAG'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setActionAndDirty(a)}
                style={{
                  padding: '6px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid var(--border-default)',
                  borderRadius: '6px',
                  background: action === a ? 'var(--dark)' : 'var(--bg-white)',
                  color: action === a ? 'white' : 'var(--dark)',
                  cursor: 'pointer',
                }}
              >
                {a === 'BLOCK' ? 'Block' : 'Flag'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Profiles Card */}
      <div
        style={{
          padding: '24px',
          border: '1px solid var(--border-default)',
          borderRadius: '12px',
          background: 'var(--bg-white)',
          marginBottom: '24px',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, marginBottom: '8px' }}>Detection Profiles</h2>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
          Select which profiles to apply to your AI Gateway.
        </p>

        {profilesLoading ? (
          <p style={{ color: '#666', fontSize: '14px' }}>Loading profiles...</p>
        ) : profiles.length === 0 ? (
          <p style={{ color: '#666', fontSize: '14px' }}>
            No DLP profiles available on this account.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {profiles.map((profile) => {
              const isSelected = selectedIds.includes(profile.id);
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => toggleProfile(profile.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    border: `1px solid ${isSelected ? 'var(--dark)' : 'var(--border-default)'}`,
                    borderRadius: '8px',
                    background: isSelected ? 'var(--bg-cream)' : 'var(--bg-white)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '4px',
                      border: `2px solid ${isSelected ? 'var(--dark)' : '#d1d5db'}`,
                      background: isSelected ? 'var(--dark)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.15s',
                    }}
                  >
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--dark)' }}>
                      {profile.name}
                    </div>
                    {profile.description && (
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                        {profile.description}
                      </div>
                    )}
                    {profile.entries.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                        {profile.entries.length} detection {profile.entries.length === 1 ? 'rule' : 'rules'}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          style={{
            padding: '10px 24px',
            fontSize: '14px',
            fontWeight: 700,
            color: 'white',
            background: dirty ? 'var(--dark)' : '#aaa',
            border: 'none',
            borderRadius: '8px',
            cursor: !dirty || save.isPending ? 'not-allowed' : 'pointer',
            opacity: save.isPending ? 0.6 : 1,
          }}
        >
          {save.isPending ? 'Saving...' : 'Save Changes'}
        </button>

        {message && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: message.type === 'success' ? '#16a34a' : '#dc2626',
            }}
          >
            {message.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
