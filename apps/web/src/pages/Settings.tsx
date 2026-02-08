import { useState, useEffect } from 'react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Copy, Key, Check, User } from 'lucide-react';

interface Customer {
  id: string;
  company_name: string;
  billing_email: string;
}

interface MeUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role?: string;
}

export function Settings() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerLoading, setCustomerLoading] = useState(true);
  const [meUser, setMeUser] = useState<MeUser | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [apiToken, setApiToken] = useState(localStorage.getItem('api_token') || '');
  const [tokenName, setTokenName] = useState('');
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [copied, setCopied] = useState(false);
  const [connectVscodeLoading, setConnectVscodeLoading] = useState(false);
  const [connectVscodeError, setConnectVscodeError] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/v1/customers/me`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.customer) setCustomer(data.customer);
        setCustomerLoading(false);
      })
      .catch(() => setCustomerLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/v1/me`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setMeUser(data.user);
          setProfileImageUrl(data.user.image ?? '');
        }
        setMeLoading(false);
      })
      .catch(() => setMeLoading(false));
  }, []);

  const saveToken = () => {
    localStorage.setItem('api_token', apiToken);
    alert('API token saved to this browser.');
  };

  const createToken = async () => {
    if (!customer?.id || !tokenName.trim()) return;
    setCreatingToken(true);
    setTokenError('');
    setCreatedToken(null);
    try {
      const res = await fetch(`${API_BASE}/v1/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          customer_id: customer.id,
          name: tokenName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create token');
      setCreatedToken(data.token?.token ?? null);
      setTokenName('');
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : 'Failed to create token');
    } finally {
      setCreatingToken(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Create a token and open VS Code via deep link so the extension can store it (no manual paste).
  const connectVscode = async () => {
    if (!customer?.id) return;
    setConnectVscodeLoading(true);
    setConnectVscodeError('');
    try {
      const res = await fetch(`${API_BASE}/v1/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          customer_id: customer.id,
          name: `VS Code – ${new Date().toISOString().slice(0, 10)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create token');
      const token = data.token?.token;
      if (!token) throw new Error('No token returned');
      const apiBase = API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
      const dashboardUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const params = new URLSearchParams({
        token,
        ...(apiBase && { baseUrl: apiBase }),
        ...(dashboardUrl && { dashboardUrl }),
      });
      const vscodeUri = `vscode://stereos.stereos-provenance/connect?${params.toString()}`;
      window.location.href = vscodeUri;
    } catch (e) {
      setConnectVscodeError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setConnectVscodeLoading(false);
    }
  };

  const saveProfileImage = async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await fetch(`${API_BASE}/v1/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ image: profileImageUrl.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      setMeUser((prev) => (prev ? { ...prev, image: profileImageUrl.trim() || null } : null));
      setProfileMessage({ type: 'success', text: 'Profile picture updated.' });
      setTimeout(() => setProfileMessage(null), 3000);
    } catch (e) {
      setProfileMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to update' });
    } finally {
      setProfileSaving(false);
    }
  };

  const baseUrl = API_BASE || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const curlOneLiner = `curl -X POST ${baseUrl}/v1/events -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" -d '{"event_type":"agent_action","actor_type":"agent","actor_id":"cursor-v1","tool":"refactor","intent":"refactor auth module","repo":"my-repo","commit":"abc123"}'`;
  const displayToken = createdToken || apiToken;

  return (
    <div>
      <h1 className="heading-1" style={{ marginBottom: '8px' }}>
        Settings
      </h1>
      <p className="text-large" style={{ marginBottom: '32px', color: '#555' }}>
        API tokens and ingestion instructions.
      </p>

      <div className="grid-2" style={{ gap: '24px' }}>
      {/* Profile picture URL */}
      <div className="card">
        <h2 className="heading-2" style={{ fontSize: '20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={20} />
          Profile picture
        </h2>
        <p style={{ color: '#555', fontSize: '15px', marginBottom: '20px' }}>
          Set a profile picture by entering an image URL. It will appear in the sidebar and on events.
        </p>

        {meLoading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '24px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  background: 'var(--bg-cream)',
                  border: '3px solid var(--border-color)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {meUser?.image || profileImageUrl ? (
                  <img
                    src={meUser?.image || profileImageUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <User size={40} color="#888" />
                )}
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                  Image URL
                </label>
                <input
                  className="input"
                  type="url"
                  value={profileImageUrl}
                  onChange={(e) => setProfileImageUrl(e.target.value)}
                  placeholder="https://..."
                  disabled={profileSaving}
                  style={{ width: '100%', marginBottom: '12px' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveProfileImage}
                  disabled={profileSaving}
                >
                  {profileSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {profileMessage && (
              <div
                style={{
                  padding: '12px',
                  background: profileMessage.type === 'success' ? 'var(--bg-mint)' : '#fee2e2',
                  border: `3px solid ${profileMessage.type === 'success' ? 'var(--border-color)' : '#dc2626'}`,
                  color: profileMessage.type === 'success' ? 'var(--dark)' : '#dc2626',
                  fontWeight: 600,
                }}
              >
                {profileMessage.text}
              </div>
            )}
          </>
        )}
      </div>

      {/* Connect VS Code extension (auth-protected; token passed via deep link) */}
      <div className="card">
        <h2 className="heading-2" style={{ fontSize: '20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key size={20} />
          Connect VS Code extension
        </h2>
        <p style={{ color: '#555', fontSize: '15px', marginBottom: '20px' }}>
          Link this account to the STEREOS extension so it can send events without pasting a token. You must be signed in here; the extension will receive the token via a secure link.
        </p>
        {customerLoading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : !customer ? (
          <p style={{ color: '#666' }}>
            {meUser?.role === 'admin'
              ? 'Complete onboarding to get a customer ID.'
              : 'Ask your workspace admin to complete setup so you can connect the extension.'}
          </p>
        ) : (
          <>
            {connectVscodeError && (
              <div style={{ marginBottom: '16px', padding: '12px', background: '#fee2e2', border: '3px solid #dc2626', color: '#dc2626', fontWeight: 600 }}>
                {connectVscodeError}
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={connectVscode}
              disabled={connectVscodeLoading}
            >
              {connectVscodeLoading ? 'Creating link…' : 'Connect VS Code'}
            </button>
            <p style={{ fontSize: '13px', color: '#666', marginTop: '12px' }}>
              Opens VS Code (or Cursor) and saves the token in the extension. No copy-paste needed.
            </p>
          </>
        )}
      </div>

      {/* Create API token */}
      <div className="card">
        <h2 className="heading-2" style={{ fontSize: '20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key size={20} />
          Create API token
        </h2>
        <p style={{ color: '#555', fontSize: '15px', marginBottom: '20px' }}>
          Use an API token to send events from agents or scripts. Your <strong>customer ID</strong> is filled in below.
        </p>

        {customerLoading ? (
          <p style={{ color: '#666' }}>Loading…</p>
        ) : !customer ? (
          <p style={{ color: '#666' }}>
            {meUser?.role === 'admin'
              ? 'Complete onboarding to get a customer ID.'
              : 'Ask your workspace admin to complete setup to create API tokens.'}
          </p>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                Customer ID (use this when creating tokens)
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  className="input"
                  type="text"
                  readOnly
                  value={customer.id}
                  style={{ fontFamily: 'monospace', fontSize: '14px' }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => copyToClipboard(customer.id)}
                  style={{ flexShrink: 0 }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                Token name (e.g. CLI, Cursor, CI)
              </label>
              <input
                className="input"
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. CLI"
                disabled={creatingToken}
              />
            </div>

            {tokenError && (
              <div style={{ marginBottom: '16px', padding: '12px', background: '#fee2e2', border: '3px solid #dc2626', color: '#dc2626', fontWeight: 600 }}>
                {tokenError}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={createToken}
              disabled={creatingToken || !tokenName.trim()}
            >
              {creatingToken ? 'Creating…' : 'Create token'}
            </button>

            {createdToken && (
              <div style={{ marginTop: '20px', padding: '16px', background: 'var(--bg-mint)', border: '3px solid var(--border-color)' }}>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>Token created — copy it now. It won’t be shown again.</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ flex: '1 1 200px', wordBreak: 'break-all', fontSize: '13px' }}>{createdToken}</code>
                  <button type="button" className="btn" onClick={() => copyToClipboard(createdToken)}>
                    <Copy size={16} /> Copy
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Ingest events */}
      <div className="card">
        <h2 className="heading-2" style={{ fontSize: '20px', marginBottom: '16px' }}>
          Ingest events
        </h2>
        <p style={{ color: '#555', fontSize: '15px', marginBottom: '12px' }}>
          1. Create a token above (or use an existing one).<br />
          2. Set <code style={{ background: '#eee', padding: '2px 6px' }}>API_TOKEN</code> and run:
        </p>
        <div
          style={{
            position: 'relative',
            background: 'var(--dark)',
            color: '#e2e8f0',
            padding: '16px',
            borderRadius: '4px',
            border: '3px solid var(--border-color)',
            overflow: 'auto',
          }}
        >
          <pre style={{ margin: 0, fontSize: '13px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {displayToken ? curlOneLiner.replace('${API_TOKEN}', displayToken) : curlOneLiner}
          </pre>
          <button
            type="button"
            className="btn"
            onClick={() => copyToClipboard(displayToken ? curlOneLiner.replace('${API_TOKEN}', displayToken) : curlOneLiner)}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'var(--bg-white)',
              color: 'var(--dark)',
              padding: '8px 12px',
              fontSize: '13px',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p style={{ fontSize: '13px', color: '#666', marginTop: '12px' }}>
          <code>timestamp</code> is optional (defaults to now). Add <code>model</code>, <code>files_written</code>, <code>branch</code> as needed.
        </p>
      </div>

      {/* Optional: save token in browser */}
      <div className="card">
        <h3 className="heading-2" style={{ fontSize: '18px', marginBottom: '12px' }}>
          Store token in this browser (optional)
        </h3>
        <p style={{ color: '#555', fontSize: '14px', marginBottom: '12px' }}>
          Save a token here so the curl above is pre-filled. Stored in localStorage only.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="sk_..."
            style={{ flex: '1 1 200px', maxWidth: '400px', fontFamily: 'monospace' }}
          />
          <button type="button" className="btn btn-primary" onClick={saveToken}>
            Save token
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
