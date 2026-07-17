import { describe, expect, it, vi } from 'bun:test';

import { createRemoteClient } from './remote';
import type { RequestContext } from './helpers';

const deviceCredential = 'a'.repeat(64);

const contextFor = (request: ReturnType<typeof vi.fn>): RequestContext =>
  ({
    request,
    buildJsonHeaders: (existing?: HeadersInit) => {
      const headers = new Headers(existing);
      headers.set('Content-Type', 'application/json');
      return headers;
    },
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
      deviceCredential,
      deviceName: 'Clay’s iPhone',
      code: 'ABCD-EFGH',
    });
    await client.listRemoteConnections({
      deviceId: 'phone-1',
      deviceCredential,
    });

    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/remote/pair', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ code: 'ABCD-EFGH', deviceName: 'Clay’s iPhone' }),
    });
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/remote/connections', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    const pairHeaders = request.mock.calls[0]?.[1]?.headers as Headers;
    const listHeaders = request.mock.calls[1]?.[1]?.headers as Headers;
    expect(pairHeaders.get('X-Device-Id')).toBe('phone-1');
    expect(pairHeaders.get('X-Device-Credential')).toBe(deviceCredential);
    expect(listHeaders.get('X-Device-Id')).toBe('phone-1');
    expect(listHeaders.get('X-Device-Credential')).toBe(deviceCredential);
  });

  it('encodes target and command IDs in relay paths', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ commandId: 'command/one' })
      .mockResolvedValueOnce({ status: 'complete', response: { result: { ok: true } } });
    const client = createRemoteClient(contextFor(request));

    const commandId = await client.enqueueRemoteRpc({
      controllerDeviceId: 'phone-1',
      deviceCredential,
      targetDeviceId: 'mac/one',
      request: { jsonrpc: '2.0', id: 1, method: 'server.ping' },
    });
    await client.getRemoteRpcResult({
      controllerDeviceId: 'phone-1',
      deviceCredential,
      targetDeviceId: 'mac/one',
      commandId,
    });

    expect(request.mock.calls[0]?.[0]).toBe('/api/v1/remote/devices/mac%2Fone/rpc');
    expect(request.mock.calls[1]?.[0]).toBe(
      '/api/v1/remote/devices/mac%2Fone/commands/command%2Fone/result'
    );
    const enqueueHeaders = request.mock.calls[0]?.[1]?.headers as Headers;
    const resultHeaders = request.mock.calls[1]?.[1]?.headers as Headers;
    expect(enqueueHeaders.get('X-Device-Credential')).toBe(deviceCredential);
    expect(resultHeaders.get('X-Device-Credential')).toBe(deviceCredential);
  });

  it('rejects malformed relay responses', async () => {
    const client = createRemoteClient(contextFor(vi.fn().mockResolvedValue({ devices: {} })));
    await expect(
      client.listRemoteConnections({
        deviceId: 'phone-1',
        deviceCredential,
      })
    ).rejects.toThrow();
  });
});
