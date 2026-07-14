import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

let storedCredential: string | null = null;
const getItemAsync = mock(async () => storedCredential);
const setItemAsync = mock(async (_key: string, value: string) => {
  storedCredential = value;
});
const getRandomBytesAsync = mock(async () => new Uint8Array(32).fill(7));

mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync,
  setItemAsync,
}));

mock.module('expo-crypto', () => ({ getRandomBytesAsync }));

const { callDesktopAppServerRpc, pairWithRemoteCode } = await import(
  '../../features/desktop-work/pairing/client'
);

const relaySession = {
  baseUrl: 'https://remote.taskforceai/device/mac-1',
  rpcPath: '/rpc',
  sessionToken: 'account-scoped',
  sessionScope: 'mobile-control' as const,
  transport: { kind: 'relay', encoding: 'json' },
  targetDeviceId: 'mac-1',
  controllerDeviceId: 'phone-1',
  deviceCredential: 'c'.repeat(64),
  machineName: 'Studio Mac',
};

const setMobileClient = (client: Record<string, unknown>) => {
  globalThis.__MOBILE_CLIENTS__ = {
    api: client as never,
    remote: client as never,
    auth: null,
    pinnedFetch: null,
  };
};

describe('desktop pairing relay client', () => {
  const originalDateNow = Date.now;

  beforeEach(() => {
    storedCredential = null;
    getItemAsync.mockClear();
    setItemAsync.mockClear();
    getRandomBytesAsync.mockClear();
    globalThis.__MOBILE_CLIENTS__ = undefined;
  });

  afterEach(() => {
    Date.now = originalDateNow;
    globalThis.__MOBILE_CLIENTS__ = undefined;
  });

  it('requires the complete relay device identity', async () => {
    await expect(
      callDesktopAppServerRpc(
        { ...relaySession, deviceCredential: undefined },
        'server.ping'
      )
    ).rejects.toThrow('Remote connection is missing its device identity.');
  });

  it('enqueues relay RPCs and returns complete results', async () => {
    const enqueueRemoteRpc = mock(async () => 'command-1');
    const getRemoteRpcResult = mock(async () => ({
      status: 'complete',
      response: { result: { ok: true } },
    }));
    setMobileClient({ enqueueRemoteRpc, getRemoteRpcResult });

    await expect(
      callDesktopAppServerRpc<{ ok: boolean }>(relaySession, 'server.ping', { verbose: true })
    ).resolves.toEqual({ ok: true });
    expect(enqueueRemoteRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        controllerDeviceId: 'phone-1',
        deviceCredential: relaySession.deviceCredential,
        targetDeviceId: 'mac-1',
      })
    );
    expect(getRemoteRpcResult).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'command-1' })
    );
  });

  it('surfaces relay JSON-RPC errors and omitted results', async () => {
    const responses = [
      { status: 'complete', response: { error: { code: -32000, message: 'failed' } } },
      { status: 'complete', response: { result: undefined } },
    ];
    setMobileClient({
      enqueueRemoteRpc: mock(async () => 'command-1'),
      getRemoteRpcResult: mock(async () => responses.shift()),
    });

    await expect(callDesktopAppServerRpc(relaySession, 'thread.list')).rejects.toThrow(
      'Desktop request failed: -32000 failed'
    );
    await expect(callDesktopAppServerRpc(relaySession, 'thread.list')).rejects.toThrow();
  });

  it('polls pending relay results and enforces the deadline', async () => {
    const getRemoteRpcResult = mock()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'complete', response: { result: 'ready' } });
    setMobileClient({
      enqueueRemoteRpc: mock(async () => 'command-1'),
      getRemoteRpcResult,
    });
    await expect(callDesktopAppServerRpc(relaySession, 'thread.list')).resolves.toBe('ready');

    let now = 1_000;
    Date.now = () => now;
    setMobileClient({
      enqueueRemoteRpc: mock(async () => 'command-2'),
      getRemoteRpcResult: mock(async () => {
        now = 32_000;
        return { status: 'pending' };
      }),
    });
    await expect(callDesktopAppServerRpc(relaySession, 'thread.list')).rejects.toThrow(
      'The Mac did not answer the Remote request in time.'
    );
  });

  it('creates a relay session after the pairing service authorizes the phone', async () => {
    const pairRemoteDevice = mock(async () => ({ deviceId: 'mac-2', deviceName: 'Lab Mac' }));
    const enqueueRemoteRpc = mock(async () => 'unused-command');
    const getRemoteRpcResult = mock(async () => ({ status: 'pending' }));
    setMobileClient({ pairRemoteDevice, enqueueRemoteRpc, getRemoteRpcResult });

    const session = await pairWithRemoteCode({
      code: 'ABCD-EFGH',
      controllerDeviceId: 'phone-2',
      controllerName: 'Clay Phone',
    });

    expect(session).toMatchObject({
      baseUrl: 'https://remote.taskforceai/device/mac-2',
      targetDeviceId: 'mac-2',
      controllerDeviceId: 'phone-2',
      machineName: 'Lab Mac',
      transport: { kind: 'relay', encoding: 'json' },
    });
    expect(pairRemoteDevice).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ABCD-EFGH', deviceId: 'phone-2' })
    );
    expect(enqueueRemoteRpc).not.toHaveBeenCalled();
    expect(getRemoteRpcResult).not.toHaveBeenCalled();
  });
});
