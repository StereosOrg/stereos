import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { CreditCard, ExternalLink } from 'lucide-react';

interface Customer {
  id: string;
  company_name: string;
  billing_email: string;
  payment_info_provided: boolean;
  billing_status?: string | null;
  onboarding_completed: boolean;
}

export function Billing() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalError, setPortalError] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/v1/customers/me`, { credentials: 'include', headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.customer) setCustomer(data.customer);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const openBillingPortal = async () => {
    setPortalError('');
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/billing/portal`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setPortalError(data.error ?? 'Failed to open billing portal');
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setPortalError('No portal URL returned');
      }
    } catch {
      setPortalError('Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
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

  const statusLabel = customer?.billing_status
    ? String(customer.billing_status).replace(/_/g, ' ')
    : customer?.payment_info_provided
      ? 'Active'
      : 'No payment method';

  return (
    <div>
      <h1 className="heading-1" style={{ marginBottom: '8px' }}>
        Billing
      </h1>
      <p className="text-large" style={{ marginBottom: '32px', color: '#555' }}>
        Subscription and payment details.
      </p>

      <div className="card" style={{ maxWidth: '560px' }}>
        <h2 className="heading-2" style={{ fontSize: '18px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CreditCard size={20} />
          Workspace billing
        </h2>
        {!customer ? (
          <p style={{ color: '#666' }}>Unable to load workspace.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                Company
              </label>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{customer.company_name || '—'}</p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                Billing email
              </label>
              <p style={{ margin: 0, fontSize: '16px' }}>{customer.billing_email || '—'}</p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                Status
              </label>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{statusLabel}</p>
            </div>
            {customer.payment_info_provided ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openBillingPortal}
                  disabled={portalLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start' }}
                >
                  <ExternalLink size={18} />
                  {portalLoading ? 'Opening…' : 'Manage subscription'}
                </button>
                {portalError && (
                  <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{portalError}</p>
                )}
              </>
            ) : (
              <Link to="/onboarding/start-trial" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start' }}>
                Start trial
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
