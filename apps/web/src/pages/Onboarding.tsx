import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowRight, ArrowLeft } from 'lucide-react';
import { API_BASE } from '../lib/api';

const titles = [
  { value: 'engineer', label: 'Engineer' },
  { value: 'manager', label: 'Engineering Manager' },
  { value: 'cto', label: 'CTO' },
  { value: 'founder', label: 'Founder' },
  { value: 'vp', label: 'VP Engineering' },
  { value: 'lead', label: 'Tech Lead' },
  { value: 'architect', label: 'Software Architect' },
  { value: 'product_manager', label: 'Product Manager' },
];

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    title: 'engineer',
    image: '',
    companyName: '',
    billingEmail: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/v1/onboarding/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      const data = await response.json();
      // Always go to start-trial embedded checkout (no payment links)
      navigate('/onboarding/start-trial');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-mint)',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                background: 'var(--dark)',
                border: '3px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '4px 4px 0 var(--border-color)',
              }}
            >
              <Zap size={24} color="white" />
            </div>
            <span style={{ fontSize: '28px', fontWeight: 800 }}>STEREOS</span>
          </div>
          <p style={{ color: '#555', fontSize: '16px' }}>
            Complete your setup to get started
          </p>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '32px',
          }}
        >
          {[1, 2].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '8px',
                background: s <= step ? 'var(--dark)' : '#ddd',
                border: '2px solid var(--border-color)',
              }}
            />
          ))}
        </div>

        {/* Card */}
        <div className="card" style={{ background: 'var(--bg-white)' }}>
          {error && (
            <div
              style={{
                background: '#fee2e2',
                border: '3px solid #dc2626',
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
                <h2 className="heading-2" style={{ fontSize: '28px', marginBottom: '8px' }}>
                  Personal Information
                </h2>
                <p style={{ color: '#666', marginBottom: '32px' }}>
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
                <h2 className="heading-2" style={{ fontSize: '28px', marginBottom: '8px' }}>
                  Company Information
                </h2>
                <p style={{ color: '#666', marginBottom: '32px' }}>
                  Set up your organization
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
                    placeholder="Acme Inc"
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
                    placeholder="billing@company.com"
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
                    {loading ? 'Creating Account...' : 'Continue to Payment'}
                    {!loading && <ArrowRight size={18} />}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', color: '#666', fontSize: '14px', marginTop: '24px' }}>
          Already have an account?{' '}
          <a href="/auth/sign-in" style={{ color: 'var(--dark)', fontWeight: 600 }}>
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
