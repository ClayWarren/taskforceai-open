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
  clearDesktopPairingSession,
  readDesktopPairingSession,
  saveDesktopPairingSession,
} = await import('../../desktop-pairing/session-store');

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

  it('clears invalid stored sessions', async () => {
    secureStoreState.set('taskforceai_desktop_pairing_session', JSON.stringify({ bad: true }));

    expect(await readDesktopPairingSession()).toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('taskforceai_desktop_pairing_session');
  });

  it('deletes saved desktop pairing sessions', async () => {
    await saveDesktopPairingSession(session);
    await clearDesktopPairingSession();

    expect(await readDesktopPairingSession()).toBeNull();
  });
});
