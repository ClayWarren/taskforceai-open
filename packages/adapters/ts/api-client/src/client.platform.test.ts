import { describe, expect, it } from 'bun:test';

import { createClientHarness, createJsonResponse, fetchCall } from './client.test-utils';

describe('createApiClient platform services', () => {
  it('loads developer storage summaries', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({
        usedBytes: 19_000_000,
        quotaBytes: 40_000_000_000,
        categories: [
          { id: 'files', label: 'Files', bytes: 105_000, count: 1 },
          { id: 'images', label: 'Images', bytes: 18_900_000, count: 45 },
        ],
      })
    );

    const summary = await client.getStorageSummary();

    expect(summary.quotaBytes).toBe(40_000_000_000);
    expect(summary.categories[1]?.label).toBe('Images');
    const [url, init] = fetchCall(fetchMock);
    expect(url).toBe('/api/v1/developer/storage');
    expect(init?.method).toBe('GET');
  });

  it('syncs mobile subscriptions', async () => {
    const { client } = createClientHarness(
      createJsonResponse({
        plan: 'free',
        subscription_status: null,
        subscription_source: 'stripe',
        current_period_end: null,
      })
    );

    const result = await client.syncMobileSubscription();
    expect(result.plan).toBe('free');
  });

  it('supports projects and integrations endpoints', async () => {
    const project = {
      id: 1,
      name: 'Launch',
      description: null,
      custom_instructions: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse([project]),
      createJsonResponse(project),
      createJsonResponse(project),
      new Response(null, { status: 204 }),
      createJsonResponse([{ id: 'github', provider: 'github', connected: true }]),
      new Response(null, { status: 204 }),
    ]);

    const projects = await client.getProjects();
    const created = await client.createProject({ name: 'Launch' });
    const updated = await client.updateProject(1, { name: 'Ship it' });
    await client.deleteProject(1);
    const integrations = await client.getIntegrations();
    await client.disconnectIntegration('github/team?debug=true');

    expect(projects).toHaveLength(1);
    expect(created.id).toBe(1);
    expect(updated.id).toBe(1);
    expect(integrations[0]?.provider).toBe('github');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/projects/1');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/v1/projects/1');
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/v1/integrations/github%2Fteam%3Fdebug%3Dtrue');
  });

  it('rejects invalid project path IDs before fetching', async () => {
    const { client, fetchMock } = createClientHarness([]);

    expect(() => client.deleteProject(0)).toThrow('Project ID must be a positive integer');
    expect(() => client.deleteProject(Number.POSITIVE_INFINITY)).toThrow(
      'Project ID must be a positive integer'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers and unregisters push tokens', async () => {
    const { client, fetchMock } = createClientHarness([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);

    await client.registerPushToken({ token: 'push-1', platform: 'web' });
    await client.unregisterPushToken('push-1');

    const registerCall = fetchCall(fetchMock);
    const [registerUrl, registerInit] = registerCall;
    expect(registerUrl).toBe('/api/v1/notifications/push-tokens');
    expect(registerInit?.method).toBe('POST');
    expect(registerInit?.body).toBe(JSON.stringify({ token: 'push-1', platform: 'web' }));

    const unregisterCall = fetchCall(fetchMock, 1);
    const [unregisterUrl, unregisterInit] = unregisterCall;
    expect(unregisterUrl).toBe('/api/v1/notifications/push-tokens');
    expect(unregisterInit?.method).toBe('DELETE');
    expect(unregisterInit?.body).toBe(JSON.stringify({ token: 'push-1' }));
  });

  it('supports GDPR export and delete account', async () => {
    const { client, fetchMock } = createClientHarness([
      new Response('export-data', { status: 200 }),
      new Response(null, { status: 204 }),
    ]);

    const exported = await client.exportGdprData();
    await client.deleteAccount({ confirmEmail: 'demo@example.com' });

    expect(exported).toBe('export-data');

    const deleteCall = fetchCall(fetchMock, 1);
    const [, deleteInit] = deleteCall;
    expect(deleteInit?.method).toBe('POST');
    expect(deleteInit?.body).toBe(JSON.stringify({ confirmEmail: 'demo@example.com' }));
  });

  it('supports finance dashboard and financial memories', async () => {
    const financeResponse = {
      connected_accounts: false,
      provider_status: 'not_connected',
      memories: [{ id: 1, content: 'Saving for a house', type: 'finance' }],
      capabilities: ['goal_planning'],
      connections: [],
      accounts: [],
      recent_transactions: [],
      recurring_streams: [],
      privacy: {
        connected_accounts_available: false,
        can_mutate_accounts: false,
        training_controls: 'uses account-level data controls',
        data_controls: ['financial memories can be deleted at any time'],
      },
    };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse(financeResponse),
      new Response(null, { status: 204 }),
      createJsonResponse({ link_token: 'link-sandbox', expiration: '2026-06-06T20:00:00Z' }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);

    const dashboard = await client.getFinanceDashboard();
    await client.createFinanceMemory({ content: 'Saving for a house' });
    const linkToken = await client.createFinanceLinkToken();
    await client.exchangeFinancePublicToken({ public_token: 'public-sandbox' });
    await client.syncFinanceData();
    await client.disconnectFinanceConnection(2);
    await client.deleteFinanceMemory(1);

    expect(dashboard.memories[0]?.content).toBe('Saving for a house');
    expect(linkToken.link_token).toBe('link-sandbox');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/finances');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/finances/memories');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/finances/link-token');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/v1/finances/exchange-public-token');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/v1/finances/sync');
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/v1/finances/connections/2');
    expect(fetchMock.mock.calls[6]?.[0]).toBe('/api/v1/finances/memories/1');
  });

  it('validates finance path ids before sending delete requests', async () => {
    const { client, fetchMock } = createClientHarness(new Response(null, { status: 204 }));

    await expect(client.disconnectFinanceConnection(0)).rejects.toThrow(
      'finance connection id must be a positive integer'
    );
    await expect(client.deleteFinanceMemory(Number.NaN)).rejects.toThrow(
      'finance memory id must be a positive integer'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates finance mutation payloads before sending requests', async () => {
    const { client, fetchMock } = createClientHarness(new Response(null, { status: 204 }));

    expect(() => client.createFinanceMemory({ content: '' })).toThrow();
    expect(() => client.exchangeFinancePublicToken({ public_token: '' })).toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
