import { describe, expect, it, vi } from 'bun:test';

import { createRemoteClient } from './remote';
import type { RequestContext } from './helpers';

const contextFor = (request: ReturnType<typeof vi.fn>): RequestContext =>
  ({
    request,
    buildJsonHeaders: () => ({ 'Content-Type': 'application/json' }),
  }) as unknown as RequestContext;

describe('Remote API client', () => {
  it('pairs and lists account-scoped devices with the controller identity', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        deviceId: 'mac/one',
        deviceName: 'Clay’s Mac',
        allowConnections: true,
        keepAwake: true,
        lastSeenAt: '2026-07-13T08:00:00Z',
      })
      .mockResolvedValueOnce({ devices: [] });
    const client = createRemoteClient(contextFor(request));

    await client.pairRemoteDevice({
      deviceId: 'phone-1',
      deviceName: 'Clay’s iPhone',
      code: 'ABCD-EFGH',
    });
    await client.listRemoteConnections('phone-1');

    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/remote/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'phone-1' },
      body: JSON.stringify({ code: 'ABCD-EFGH', deviceName: 'Clay’s iPhone' }),
    });
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/remote/connections', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'phone-1' },
    });
  });

  it('encodes target and command IDs in relay paths', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ commandId: 'command/one' })
      .mockResolvedValueOnce({ status: 'complete', response: { result: { ok: true } } });
    const client = createRemoteClient(contextFor(request));

    const commandId = await client.enqueueRemoteRpc({
      controllerDeviceId: 'phone-1',
      targetDeviceId: 'mac/one',
      request: { jsonrpc: '2.0', id: 1, method: 'server.ping' },
    });
    await client.getRemoteRpcResult({
      controllerDeviceId: 'phone-1',
      targetDeviceId: 'mac/one',
      commandId,
    });

    expect(request.mock.calls[0]?.[0]).toBe('/api/v1/remote/devices/mac%2Fone/rpc');
    expect(request.mock.calls[1]?.[0]).toBe(
      '/api/v1/remote/devices/mac%2Fone/commands/command%2Fone/result'
    );
  });

  it('rejects malformed relay responses', async () => {
    const client = createRemoteClient(contextFor(vi.fn().mockResolvedValue({ devices: {} })));
    await expect(client.listRemoteConnections('phone-1')).rejects.toThrow();
  });
});
