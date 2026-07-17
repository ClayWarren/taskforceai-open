import { beforeEach, describe, expect, it, mock } from 'bun:test';

const secureStoreState = new Map<string, string>();
const getItemAsync = mock(async (key: string) => secureStoreState.get(key) ?? null);
const setItemAsync = mock(async (key: string, value: string) => {
  secureStoreState.set(key, value);
});
const deleteItemAsync = mock(async (key: string) => {
  secureStoreState.delete(key);
});

mock.module('expo-secure-store', () => ({
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
}));

const {
  clearAllDesktopPairingSessions,
  clearDesktopPairingSession,
  readDesktopPairingHosts,
  readDesktopPairingSession,
  saveDesktopPairingSession,
  selectDesktopPairingHost,
} = await import('../../features/desktop-work/pairing/session-store');

const session = {
  baseUrl: 'http://127.0.0.1:7319',
  rpcPath: '/rpc',
  sessionToken: 'session-token',
  transport: { kind: 'http', encoding: 'json' },
};

describe('desktop pairing session store', () => {
  beforeEach(() => {
    secureStoreState.clear();
    getItemAsync.mockClear();
    setItemAsync.mockClear();
    deleteItemAsync.mockClear();
  });

  it('saves and reads desktop pairing sessions', async () => {
    await saveDesktopPairingSession(session);

    expect(await readDesktopPairingSession()).toEqual(session);
    expect(setItemAsync).toHaveBeenCalledWith(
      'taskforceai_desktop_pairing_session',
      JSON.stringify(session)
    );
  });

  it('saves and reads authenticated relay sessions', async () => {
    const relaySession = {
      ...session,
      baseUrl: 'https://remote.taskforceai/device/mac-1',
      sessionScope: 'mobile-control' as const,
      transport: { kind: 'relay', encoding: 'json' },
      targetDeviceId: 'mac-1',
      controllerDeviceId: 'phone-1',
      deviceCredential: 'c'.repeat(64),
      machineName: 'Studio Mac',
    };

    await saveDesktopPairingSession(relaySession);

    expect(await readDesktopPairingSession()).toEqual(relaySession);
  });

  it('migrates a valid legacy session into the host store', async () => {
    secureStoreState.set('taskforceai_desktop_pairing_session', JSON.stringify(session));

    expect(await readDesktopPairingSession()).toEqual(session);
    expect(await readDesktopPairingHosts()).toEqual([
      expect.objectContaining({ id: session.baseUrl, session }),
    ]);
  });

  it('uses a safe fallback name for malformed host URLs', async () => {
    await saveDesktopPairingSession({ ...session, baseUrl: 'not a URL' }, ' ');

    const hostsWrite = setItemAsync.mock.calls.find(
      ([key]) => key === 'taskforceai_desktop_pairing_hosts_v2'
    );
    expect(JSON.parse(hostsWrite?.[1] ?? '{}').hosts).toEqual([
      expect.objectContaining({ id: 'not a url', name: 'Desktop' }),
    ]);
  });

  it('clears invalid stored sessions', async () => {
    secureStoreState.set('taskforceai_desktop_pairing_session', JSON.stringify({ bad: true }));

    expect(await readDesktopPairingSession()).toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_session');
  });

  it('clears stored sessions with malformed transport fields', async () => {
    secureStoreState.set(
      'taskforceai_desktop_pairing_session',
      JSON.stringify({
        ...session,
        transport: { kind: '', encoding: 'json' },
      })
    );

    expect(await readDesktopPairingSession()).toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_session');
  });

  it('clears stored sessions with unsafe URLs', async () => {
    secureStoreState.set(
      'taskforceai_desktop_pairing_session',
      JSON.stringify({
        ...session,
        rpcPath: '//attacker.example/rpc',
      })
    );

    expect(await readDesktopPairingSession()).toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_session');
  });

  it('clears stored sessions with malformed base URLs', async () => {
    secureStoreState.set(
      'taskforceai_desktop_pairing_session',
      JSON.stringify({ ...session, baseUrl: 'not a URL' })
    );

    expect(await readDesktopPairingSession()).toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_session');
  });

  it('deletes saved desktop pairing sessions', async () => {
    await saveDesktopPairingSession(session);
    await clearDesktopPairingSession();

    expect(await readDesktopPairingSession()).toBeNull();
  });

  it('stores multiple named hosts and switches the active host', async () => {
    const secondSession = {
      ...session,
      baseUrl: 'https://studio-mac.example:7319',
      sessionToken: 'second-token',
    };
    await saveDesktopPairingSession(session, 'Office Mac');
    await saveDesktopPairingSession(secondSession, 'Studio Mac');

    expect((await readDesktopPairingHosts()).map((host) => host.name)).toEqual([
      'Office Mac',
      'Studio Mac',
    ]);
    expect(await readDesktopPairingSession()).toEqual(secondSession);

    await selectDesktopPairingHost(session.baseUrl.toLowerCase());
    expect(await readDesktopPairingSession()).toEqual(session);

    await clearDesktopPairingSession();
    expect(await readDesktopPairingSession()).toEqual(secondSession);
    expect(await readDesktopPairingHosts()).toHaveLength(1);
  });

  it('clears every saved desktop pairing session for account logout', async () => {
    const secondSession = {
      ...session,
      baseUrl: 'https://studio-mac.example:7319',
      sessionToken: 'second-token',
    };
    await saveDesktopPairingSession(session, 'Office Mac');
    await saveDesktopPairingSession(secondSession, 'Studio Mac');

    await clearAllDesktopPairingSessions();

    expect(await readDesktopPairingSession()).toBeNull();
    expect(await readDesktopPairingHosts()).toEqual([]);
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_session');
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_hosts_v2');
  });
});
