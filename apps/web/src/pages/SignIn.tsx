import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Key, Zap } from 'lucide-react';
import { SplitAuthLayout } from '../components/SplitAuthLayout';
import { getCallbackURL } from '../lib/api';
import { authClient } from '../lib/auth-client';


export function SignIn() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await authClient.signIn.magicLink({
      email,
      callbackURL: getCallbackURL(redirect),
    });
    setLoading(false);
    if (err) {
      setError(err.message || 'Something went wrong');
      return;
    }
    setSent(true);
  };


  const leftPanel = (
    <div>
      <h1
        style={{
          fontFamily: "'Sora', sans-serif",
          fontSize: 'clamp(24px, 4vw, 32px)',
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: '-0.03em',
          color: '#0f172a',
          marginBottom: '20px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        AI usage telemetry and managed keys for your team
      </h1>
      <p style={{ color: '#475569', fontSize: '16px', lineHeight: 1.65, marginBottom: '32px', fontWeight: 500 }}>
        Stereos helps engineering teams observe AI usage, provision OpenRouter keys, and keep costs under control.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {[
          { icon: BarChart3, text: 'Trace LLM calls and usage across tools like Cursor, CLI, and agents', color: '#059669', bg: 'rgba(5,150,105,0.12)' },
          { icon: Key, text: 'Manage OpenRouter keys with per-user limits and team visibility', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
          { icon: Zap, text: 'Metered billing — pay for what you use, no surprises', color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
        ].map(({ icon: Icon, text, color, bg }) => (
          <li
            key={text.slice(0, 20)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '16px',
              marginBottom: '24px',
              fontSize: '16px',
              color: '#334155',
              lineHeight: 1.55,
              fontWeight: 500,
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: bg,
                border: `1px solid ${color}33`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}
            >
              <Icon size={22} color={color} strokeWidth={2.5} />
            </div>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  if (sent) {
    return (
      <SplitAuthLayout
        leftPanel={leftPanel}
        rightPanel={
          <div style={{ width: '100%' }}>
            <p
              style={{
                fontFamily: "'Sora', sans-serif",
                color: '#64748b',
                fontSize: '15px',
                marginBottom: '24px',
                textAlign: 'center',
                fontWeight: 500,
              }}
            >
              Check your email
            </p>
            <div
              className="card"
              style={{
                background: 'var(--bg-white)',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 20px -5px rgba(0,0,0,0.04)',
                border: '1px solid #e2e8f0',
              }}
            >
              <p style={{ fontSize: '15px', lineHeight: 1.6, marginBottom: '16px' }}>
                We sent a magic link to <strong>{email}</strong>. Click the link in your email to sign in.
              </p>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px' }}>
                The link expires in 10 minutes. Check your spam folder if you don't see it.
              </p>
              <button
                type="button"
                className="btn"
                style={{ width: '100%' }}
                onClick={() => {
                  setSent(false);
                  setError('');
                }}
              >
                Try a different email
              </button>
            </div>
          </div>
        }
        rightPanelMaxWidth={420}
        centerRightPanel
      />
    );
  }

  return (
    <SplitAuthLayout
      leftPanel={leftPanel}
      rightPanel={
        <div style={{ width: '100%' }}>
          <p
            style={{
              fontFamily: "'Sora', sans-serif",
              color: '#64748b',
              fontSize: '15px',
              marginBottom: '24px',
              textAlign: 'center',
              fontWeight: 500,
            }}
          >
            Welcome to Stereos
          </p>
          <div
            className="card"
            style={{
              background: 'var(--bg-white)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 20px -5px rgba(0,0,0,0.04)',
              border: '1px solid #e2e8f0',
            }}
          >
            {error && (
              <div
                style={{
                  background: '#fee2e2',
                  border: '1px solid #dc2626',
                  padding: '12px 16px',
                  marginBottom: '20px',
                  color: '#dc2626',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleMagicLink}>
              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '8px',
                  }}
                >
                  Email
                </label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
                style={{ width: '100%', marginBottom: '20px' }}
              >
                {loading ? 'Sending link...' : 'Send magic link'}
              </button>
            </form>
          </div>
        </div>
      }
      rightPanelMaxWidth={420}
      centerRightPanel
    />
  );
}
