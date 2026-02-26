import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level spy — shared across all Stripe instances so we can assert on it
// even when Stripe is never instantiated (early-exit paths)
const mockMeterEventCreate = vi.fn().mockResolvedValue({});

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    billing: {
      meterEvents: {
        create: mockMeterEventCreate,
      },
    },
  })),
}));

import { trackAiProxyUsage, STRIPE_METER_EVENT_GATEWAY_EVENTS } from '../stripe.js';

function makeDb(stripeId: string | null) {
  return {
    query: {
      customers: {
        findFirst: vi.fn().mockResolvedValue(
          stripeId ? { customer_stripe_id: stripeId } : null
        ),
      },
    },
  } as any;
}

describe('trackAiProxyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports microdollars to the gateway_events meter with 20% markup', async () => {
    const db = makeDb('cus_test123');
    await trackAiProxyUsage(db, 'customer-uuid', 0.05, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).toHaveBeenCalledOnce();
    const call = create.mock.calls[0][0];
    expect(call.event_name).toBe(STRIPE_METER_EVENT_GATEWAY_EVENTS);
    // $0.05 * 1.2 → 60,000 microdollars
    expect(call.payload.value).toBe('60000');
    expect(call.payload.stripe_customer_id).toBe('cus_test123');
  });

  it('converts sub-cent costs accurately to microdollars with 20% markup', async () => {
    const db = makeDb('cus_test456');
    // $0.000030 * 1.2 → 36 microdollars
    await trackAiProxyUsage(db, 'customer-uuid', 0.00003, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].payload.value).toBe('36');
  });

  it('does not report when costUsd is 0', async () => {
    const db = makeDb('cus_test123');
    await trackAiProxyUsage(db, 'customer-uuid', 0, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).not.toHaveBeenCalled();
  });

  it('does not report when costUsd is negative', async () => {
    const db = makeDb('cus_test123');
    await trackAiProxyUsage(db, 'customer-uuid', -1, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).not.toHaveBeenCalled();
  });

  it('does not report when customer has no Stripe ID', async () => {
    const db = makeDb(null);
    await trackAiProxyUsage(db, 'customer-uuid', 0.10, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).not.toHaveBeenCalled();
  });

  it('does not report for mock Stripe customer IDs', async () => {
    const db = makeDb('mock_cust_12345');
    await trackAiProxyUsage(db, 'customer-uuid', 0.10, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).not.toHaveBeenCalled();
  });

  it('rounds fractional microdollars to nearest integer after markup', async () => {
    const db = makeDb('cus_test789');
    // $0.0000015 * 1.2 → 1.8 microdollars → rounds to 2
    await trackAiProxyUsage(db, 'customer-uuid', 0.0000015, 'sk_test_key');

    const create = mockMeterEventCreate;
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].payload.value).toBe('2');
  });
});
