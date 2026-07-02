import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const getPairingInfoMock = vi.fn();
const pairMock = vi.fn();
const pingMock = vi.fn();

vi.mock('./app-server', () => ({
  getDesktopAppServerHttpPairingInfo: getPairingInfoMock,
}));

vi.mock('./http-app-server', () => ({
  pairDesktopHttpAppServer: pairMock,
  pingDesktopHttpAppServer: pingMock,
}));

import { useDesktopHttpAppServerPairing } from './useDesktopHttpAppServerPairing';

const oldInfo = {
  baseUrl: 'http://127.0.0.1:7319',
  pairingCode: 'old-code',
  rpcPath: '/rpc',
  transport: { kind: 'http', encoding: 'json' },
};

const freshInfo = {
  baseUrl: 'http://127.0.0.1:7319',
  pairingCode: 'fresh-code',
  rpcPath: '/rpc',
  transport: { kind: 'http', encoding: 'json' },
};

const oldSession = {
  baseUrl: 'http://127.0.0.1:7319',
  sessionToken: 'old-session',
  rpcPath: '/rpc',
  transport: { kind: 'http', encoding: 'json' },
};

const freshSession = {
  baseUrl: 'http://127.0.0.1:7319',
  sessionToken: 'fresh-session',
  rpcPath: '/rpc',
  transport: { kind: 'http', encoding: 'json' },
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe('useDesktopHttpAppServerPairing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPairingInfoMock.mockResolvedValue(freshInfo);
    pairMock.mockResolvedValue(freshSession);
    pingMock.mockResolvedValue({ ok: true });
  });

  it('pairs and pings the desktop app-server on mount', async () => {
    const { result } = renderHook(() => useDesktopHttpAppServerPairing());

    expect(result.current.status).toBe('pairing');

    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(result.current.session).toEqual(freshSession);
    expect(result.current.error).toBeNull();
    expect(getPairingInfoMock).toHaveBeenCalledTimes(1);
    expect(pairMock).toHaveBeenCalledWith(freshInfo);
    expect(pingMock).toHaveBeenCalledWith(freshSession);
  });

  it('reports pairing failures without keeping a stale session', async () => {
    getPairingInfoMock.mockRejectedValueOnce(new Error('pairing code unavailable'));

    const { result } = renderHook(() => useDesktopHttpAppServerPairing());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.session).toBeNull();
    expect(result.current.error).toBe('pairing code unavailable');
  });

  it('ignores stale pairing results after a newer connect request wins', async () => {
    const oldInfoDeferred = deferred<typeof oldInfo>();
    getPairingInfoMock.mockReset();
    getPairingInfoMock
      .mockReturnValueOnce(oldInfoDeferred.promise)
      .mockResolvedValueOnce(freshInfo);
    pairMock.mockImplementation((info) =>
      Promise.resolve(info.pairingCode === 'old-code' ? oldSession : freshSession)
    );

    const { result } = renderHook(() => useDesktopHttpAppServerPairing());
    await waitFor(() => expect(getPairingInfoMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.session).toEqual(freshSession);

    oldInfoDeferred.resolve(oldInfo);
    await waitFor(() => expect(pairMock).toHaveBeenCalledWith(oldInfo));
    expect(result.current.session).toEqual(freshSession);
  });
});
