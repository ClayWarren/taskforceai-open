import { renderToString } from 'react-dom/server';

import { runLatencyBenchmarkSuite, sleepMs } from '../../../scripts/perf/latency-benchmark';
import { IncidentHistory } from '../app/components/status/IncidentHistory';
import { ServiceStatusCard } from '../app/components/status/ServiceStatusCard';
import { StatusBanner } from '../app/components/status/StatusBanner';
import { TooltipProvider } from '@taskforceai/ui-kit/tooltip';
import { fetchStatus } from '../app/lib/api/status';

const statusPayload = {
  overallStatus: 'operational',
  services: [
    {
      id: 'api',
      name: 'TaskForceAI API',
      status: 'operational',
      uptimePercent: 99.99,
      uptimeHistory: [
        { date: '2026-06-18', status: 'operational' },
        { date: '2026-06-19', status: 'operational' },
        { date: '2026-06-20', status: 'operational' },
      ],
    },
  ],
  incidents: [
    {
      id: 'inc_1',
      title: 'Resolved maintenance',
      status: 'operational',
      affectedServices: ['api'],
      updates: [
        {
          id: 'upd_1',
          status: 'operational',
          message: 'Maintenance complete.',
          createdAt: '2026-06-20T00:00:00.000Z',
        },
      ],
      createdAt: '2026-06-20T00:00:00.000Z',
      resolvedAt: '2026-06-20T01:00:00.000Z',
    },
  ],
  lastUpdated: new Date().toISOString(),
};

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const createMockFetch = (delayMs = 1): typeof fetch => {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    await sleepMs(delayMs);
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, 'https://status.local');
    if (parsed.pathname === '/status.json' || parsed.pathname === '/api/v1/status') {
      return jsonResponse(statusPayload);
    }
    return new Response('not found', { status: 404 });
  };
  const typedFetch = fetchImpl as typeof fetch;
  typedFetch.preconnect = () => {};
  return typedFetch;
};

globalThis.fetch = createMockFetch();

await runLatencyBenchmarkSuite('status public P1', [
  {
    name: 'public-status-fetch',
    run: async () => {
      const status = await fetchStatus();
      if (!status) throw new Error('status fetch returned null');
    },
  },
  {
    name: 'public-status-render',
    run: () => {
      const html = renderToString(
        <TooltipProvider delayDuration={100}>
          <StatusBanner status="operational" />
          <ServiceStatusCard service={statusPayload.services[0]} />
          <IncidentHistory incidents={statusPayload.incidents} />
        </TooltipProvider>
      );
      if (!html.includes('TaskForceAI API')) throw new Error('status page render failed');
    },
  },
]);
