import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowLeft, BarChart3, Key, Zap } from 'lucide-react';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { SplitAuthLayout } from '../components/SplitAuthLayout';
import { analytics } from '../lib/customerio';

const titles = [
  { value: 'engineer', label: 'Engineer' },
  { value: 'manager', label: 'Engineering Manager' },
  { value: 'cto', label: 'CTO' },
  { value: 'founder', label: 'Founder' },
  { value: 'vp', label: 'VP Engineering' },
  { value: 'lead', label: 'Tech Lead' },
  { value: 'architect', label: 'Software Architect' },
  { value: 'devrel', label: 'Designer' },
  { value: 'designer', label: 'Designer' },
  { value: 'product_manager', label: 'Product Manager' },
];

const REF_STORAGE_KEY = 'stereos_ref';

export function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMember, setIsMember] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    title: 'engineer',
    image: '',
    companyName: '',
    billingEmail: '',
  });

  // Fire "Onboarding Started" once on mount
  const firedRef = useRef(false);
  useEffect(() => {
    if (!firedRef.current) {
      analytics.track('Onboarding Started');
      firedRef.current = true;
    }
  }, []);

  // Persist ref from URL (e.g. ?ref=ACME) so it survives sign-in redirect
  useEffect(() => {
    const ref = searchParams.get('ref')?.trim();
    if (ref) {
      try {
        sessionStorage.setItem(REF_STORAGE_KEY, ref);
      } catch {
        // ignore
      }
    }
  }, [searchParams]);

  // Fetch onboarding status to pre-fill company info for invited members
  useEffect(() => {
    fetch(`${API_BASE}/v1/onboarding/status`, {
      credentials: 'include',
      headers: getAuthHeaders(),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.isMember && data.customer) {
          setIsMember(true);
          setFormData((prev) => ({
            ...prev,
            companyName: data.customer.company_name || '',
            billingEmail: data.customer.billing_email || '',
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let ref: string | undefined;
      try {
        ref = sessionStorage.getItem(REF_STORAGE_KEY)?.trim() || undefined;
        if (ref) sessionStorage.removeItem(REF_STORAGE_KEY);
      } catch {
        ref = undefined;
      }
      const payload = { ...formData, ...(ref && { ref }) };
      const response = await fetch(`${API_BASE}/v1/onboarding/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      await response.json();
      analytics.track('Onboarding Completed', { isMember });
      // Invited members skip payment setup — go to dashboard or pending page
      if (isMember) {
        navigate('/', { replace: true });
        return;
      }
      // Workspace owners proceed to payment setup
      navigate('/onboarding/start-trial');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
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

  const rightPanel = (
    <div style={{ width: '100%' }}>
      <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: '20px', fontWeight: 700, textAlign: 'center', marginBottom: '20px', color: '#0f172a' }}>
        Start your 14-day free trial of Stereos
      </h2>
      <p
        style={{
          fontFamily: "'Sora', sans-serif",
          color: '#64748b',
          fontSize: '15px',
          marginBottom: '20px',
          textAlign: 'center',
          fontWeight: 500,
        }}
      >
        Complete your setup to get started
      </p>

      {/* Progress Bar */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginBottom: '28px',
          }}
        >
          {[1, 2].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '6px',
                borderRadius: '3px',
                background: s <= step ? 'var(--gradient-auth-accent)' : '#e2e8f0',
                boxShadow: s <= step ? '0 2px 6px rgba(5,150,105,0.25)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Card */}
        <div
          className="card"
          style={{
            background: 'var(--bg-white)',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '32px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 20px -5px rgba(0,0,0,0.04)',
          }}
        >
          {error && (
            <div
              style={{
                background: '#fee2e2',
                border: '1px solid #dc2626',
                padding: '16px',
                marginBottom: '24px',
                color: '#dc2626',
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {step === 1 && (
              <>
                <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: '20px', fontWeight: 700, marginBottom: '8px', color: '#0f172a' }}>
                  Personal Information
                </h2>
                <p style={{ color: '#64748b', marginBottom: '28px', fontSize: '15px' }}>
                  Tell us about yourself
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: 600,
                        marginBottom: '8px',
                      }}
                    >
                      First Name *
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={formData.firstName}
                      onChange={(e) =>
                        setFormData({ ...formData, firstName: e.target.value })
                      }
                      required
                      placeholder="Jane"
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: 600,
                        marginBottom: '8px',
                      }}
                    >
                      Last Name *
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={formData.lastName}
                      onChange={(e) =>
                        setFormData({ ...formData, lastName: e.target.value })
                      }
                      required
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      marginBottom: '8px',
                    }}
                  >
                    Title *
                  </label>
                  <select
                    className="select"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                  >
                    {titles.map((title) => (
                      <option key={title.value} value={title.value}>
                        {title.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '32px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      marginBottom: '8px',
                    }}
                  >
                    Profile Picture URL
                  </label>
                  <input
                    type="url"
                    className="input"
                    value={formData.image}
                    onChange={(e) =>
                      setFormData({ ...formData, image: e.target.value })
                    }
                    placeholder="https://example.com/photo.jpg"
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setStep(2)}
                  style={{ width: '100%' }}
                >
                  Continue
                  <ArrowRight size={18} />
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: '20px', fontWeight: 700, marginBottom: '8px', color: '#0f172a' }}>
                  Company Information
                </h2>
                <p style={{ color: '#64748b', marginBottom: '28px', fontSize: '15px' }}>
                  {isMember ? 'Your organization details' : 'Set up your organization'}
                </p>

                <div style={{ marginBottom: '20px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      marginBottom: '8px',
                    }}
                  >
                    Company Name *
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={formData.companyName}
                    onChange={(e) =>
                      setFormData({ ...formData, companyName: e.target.value })
                    }
                    required
                    readOnly={isMember}
                    placeholder="Acme Inc"
                    style={isMember ? { background: '#f5f5f5', color: '#888', cursor: 'not-allowed' } : undefined}
                  />
                </div>

                <div style={{ marginBottom: '32px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      marginBottom: '8px',
                    }}
                  >
                    Billing Email *
                  </label>
                  <input
                    type="email"
                    className="input"
                    value={formData.billingEmail}
                    onChange={(e) =>
                      setFormData({ ...formData, billingEmail: e.target.value })
                    }
                    required
                    readOnly={isMember}
                    placeholder="billing@company.com"
                    style={isMember ? { background: '#f5f5f5', color: '#888', cursor: 'not-allowed' } : undefined}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setStep(1)}
                    style={{ flex: 1 }}
                  >
                    <ArrowLeft size={18} />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary"
                    style={{ flex: 2 }}
                  >
                    {loading ? 'Setting up...' : isMember ? 'Complete Setup' : 'Continue to Payment'}
                    {!loading && <ArrowRight size={18} />}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>

      {/* Footer */}
      <p style={{ textAlign: 'center', color: '#64748b', fontSize: '14px', marginTop: '28px', fontWeight: 500 }}>
        Already have an account?{' '}
        <a href="/auth/sign-in" style={{ color: 'var(--dark)', fontWeight: 600 }}>
          Sign in
        </a>
      </p>
    </div>
  );

  return (
    <SplitAuthLayout
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      rightPanelMaxWidth={560}
    />
  );
}
