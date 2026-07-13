import { clearBrowserClientCache } from '@taskforceai/api-client/browserClient';

import { runLatencyBenchmarkSuite, sleepMs } from '../../../scripts/perf/latency-benchmark';
import { createApiKey, fetchUsageStats, revokeApiKey } from '../app/lib/api/developer';
import {
  createPortalSession,
  fetchBalance,
  fetchInvoices,
  fetchPaymentMethods,
} from '@taskforceai/api-client/api/billing';

process.env['NEXT_PUBLIC_API_URL'] = 'https://console.local';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const usageStats = {
  totalRequests: 4500,
  requestsThisMonth: 1800,
  requestsThisWeek: 420,
  requestsToday: 70,
  monthlyQuota: 10000,
  monthlyRemaining: 8200,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  apiKeys: [
    {
      keyId: 1,
      displayKey: 'tfai_live_1234',
      tier: 'pro',
      createdAt: '2026-06-01T00:00:00.000Z',
      lastUsedAt: '2026-06-20T00:00:00.000Z',
      revokedAt: null,
      hourlyLimit: 500,
      monthlyQuota: 10000,
      currentHourlyUsage: 12,
      dailyUsage: 70,
      weeklyUsage: 420,
      monthlyUsage: 1800,
    },
  ],
  usageHistory: [
    { date: '2026-06-18', count: 58 },
    { date: '2026-06-19', count: 64 },
    { date: '2026-06-20', count: 70 },
  ],
};

const balance = {
  creditBalance: 125.5,
  autoRechargeEnabled: true,
  autoRechargeAmount: 50,
  autoRechargeThreshold: 20,
  subscriptionStatus: 'active',
  subscriptionId: 'sub_123',
  cancelAtPeriodEnd: false,
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
};

const paymentMethods = [
  {
    id: 'pm_123',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
    isDefault: true,
  },
];

const invoices = [
  {
    id: 'in_123',
    number: 'INV-001',
    amountPaid: 4900,
    currency: 'usd',
    status: 'paid',
    createdAt: '2026-06-01T00:00:00.000Z',
    invoicePdf: 'https://billing.stripe.com/invoice.pdf',
    hostedUrl: 'https://billing.stripe.com/invoice',
  },
];

const createMockFetch = (delayMs = 1): typeof fetch => {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await sleepMs(delayMs);
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(url, 'https://console.local').pathname;
    const method = String(init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/developer/usage') return jsonResponse(usageStats);
    if (pathname === '/api/v1/developer/keys' && method === 'POST') {
      return jsonResponse({ apiKey: 'tfai_live_new_key' });
    }
    if (pathname === '/api/v1/developer/keys' && method === 'DELETE') {
      return jsonResponse({});
    }
    if (pathname === '/api/v1/billing/balance') return jsonResponse(balance);
    if (pathname === '/api/v1/billing/payment-methods') return jsonResponse(paymentMethods);
    if (pathname === '/api/v1/billing/invoices') return jsonResponse(invoices);
    if (pathname === '/api/v1/billing/portal') {
      return jsonResponse({ url: 'https://billing.stripe.com/portal/session' });
    }
    return new Response('not found', { status: 404 });
  };
  const typedFetch = fetchImpl as typeof fetch;
  typedFetch.preconnect = () => {};
  return typedFetch;
};

globalThis.fetch = createMockFetch();
clearBrowserClientCache();

await runLatencyBenchmarkSuite('console route-data P1', [
  {
    name: 'developer-usage-fetch',
    run: async () => {
      const result = await fetchUsageStats();
      if (!result.ok) throw new Error(result.error.message);
    },
  },
  {
    name: 'developer-api-key-create',
    run: async () => {
      const result = await createApiKey();
      if (!result.ok) throw new Error(result.error.message);
    },
  },
  {
    name: 'developer-api-key-revoke',
    run: async () => {
      const result = await revokeApiKey(1);
      if (!result.ok) throw new Error(result.error.message);
    },
  },
  {
    name: 'billing-balance-fetch',
    run: async () => {
      const result = await fetchBalance();
      if (!result.ok) throw new Error(result.error.message);
    },
  },
  {
    name: 'billing-payment-methods-fetch',
    run: async () => {
      const result = await fetchPaymentMethods();
      if (!result.ok) throw new Error(result.error.message);
    },
  },
  {
    name: 'billing-invoices-fetch',
    run: async () => {
      const result = await fetchInvoices();
      if (!result.ok) throw new Error(result.error.message);
    },
  },
  {
    name: 'billing-portal-session-create',
    run: async () => {
      const result = await createPortalSession();
      if (!result.ok) throw new Error(result.error.message);
    },
  },
]);
