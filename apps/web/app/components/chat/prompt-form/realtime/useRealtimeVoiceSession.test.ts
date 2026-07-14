import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

import '../../../../../../../tests/setup/dom';

import { REALTIME_SETUP_ENDPOINT } from '@taskforceai/client-runtime';
import {
  createDeferred,
  createFetchMock,
  createRealtimeSessionFixture,
  experimentalUseRealtimeMock,
  getCsrfTokenMock,
  getStoredTokenMock,
  installRealtimeBrowserTestEnvironment,
  loadModule,
  usePlatformRuntimeMock,
} from './useRealtimeVoiceSession.test-fixtures';

describe.serial('connectRealtimeWithCsrf', () => {
  let restoreBrowserEnvironment: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreBrowserEnvironment = installRealtimeBrowserTestEnvironment();
    getCsrfTokenMock.mockResolvedValue('csrf-token');
    getStoredTokenMock.mockReturnValue({ ok: true, value: 'browser-token' });
    usePlatformRuntimeMock.mockReturnValue('browser');
  });

  afterEach(() => {
    restoreBrowserEnvironment();
  });

  it('adds auth and csrf to realtime setup requests and restores fetch after connect', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      await fetch(REALTIME_SETUP_ENDPOINT, {
        headers: { 'Content-Type': 'application/json' },
      });
      await fetch('/api/other', {
        headers: { Accept: 'application/json' },
      });
    });

    expect(globalThis.fetch).toBe(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const setupCall = fetchMock.mock.calls[0];
    const otherCall = fetchMock.mock.calls[1];
    if (!setupCall || !otherCall) {
      throw new Error('Expected realtime and non-realtime fetch calls');
    }

    const setupHeaders = new Headers(setupCall[1]?.headers);
    expect(setupHeaders.get('Content-Type')).toBe('application/json');
    expect(setupHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(setupHeaders.get('authorization')).toBe('Bearer browser-token');

    const otherHeaders = new Headers(otherCall[1]?.headers);
    expect(otherHeaders.get('Accept')).toBe('application/json');
    expect(otherHeaders.get('X-CSRF-Token')).toBeNull();
    expect(otherHeaders.get('authorization')).toBeNull();
  });

  it('restores fetch when connect fails', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await expect(
      connectRealtimeWithCsrf(async () => {
        throw new Error('connect failed');
      })
    ).rejects.toThrow('connect failed');

    expect(globalThis.fetch).toBe(fetchMock);
  });

  it('restores the base fetch after overlapping realtime connects finish out of order', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();
    const firstStarted = createDeferred<void>();
    const secondStarted = createDeferred<void>();
    const firstConnect = createDeferred<void>();
    const secondConnect = createDeferred<void>();

    const firstPromise = connectRealtimeWithCsrf(async () => {
      firstStarted.resolve();
      await firstConnect.promise;
    });
    await firstStarted.promise;
    expect(globalThis.fetch).not.toBe(fetchMock);

    const secondPromise = connectRealtimeWithCsrf(async () => {
      secondStarted.resolve();
      await secondConnect.promise;
    });
    await secondStarted.promise;
    const activeFetch = globalThis.fetch;
    expect(activeFetch).not.toBe(fetchMock);

    firstConnect.resolve();
    await firstPromise;
    expect(globalThis.fetch).toBe(activeFetch);

    secondConnect.resolve();
    await secondPromise;
    expect(globalThis.fetch).toBe(fetchMock);

    await fetch(REALTIME_SETUP_ENDPOINT);
    const restoredCall = fetchMock.mock.calls.at(-1);
    if (!restoredCall) {
      throw new Error('Expected restored fetch call');
    }
    const restoredHeaders = new Headers(restoredCall[1]?.headers);
    expect(restoredHeaders.get('X-CSRF-Token')).toBeNull();
    expect(restoredHeaders.get('authorization')).toBeNull();
  });

  it('uses bearer auth when csrf is unavailable', async () => {
    getCsrfTokenMock.mockResolvedValue('');
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      await fetch(REALTIME_SETUP_ENDPOINT);
    });

    const setupCall = fetchMock.mock.calls[0];
    if (!setupCall) {
      throw new Error('Expected realtime fetch call');
    }
    const setupHeaders = new Headers(setupCall[1]?.headers);
    expect(setupHeaders.get('authorization')).toBe('Bearer browser-token');
    expect(setupHeaders.get('X-CSRF-Token')).toBeNull();
  });

  it('does not attach realtime auth headers to off-origin setup-shaped requests', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      await fetch(`https://attacker.example${REALTIME_SETUP_ENDPOINT}`);
    });

    const setupCall = fetchMock.mock.calls[0];
    if (!setupCall) {
      throw new Error('Expected off-origin fetch call');
    }
    const setupHeaders = new Headers(setupCall[1]?.headers);
    expect(setupHeaders.get('authorization')).toBeNull();
    expect(setupHeaders.get('X-CSRF-Token')).toBeNull();
  });

  it('fails before connect when auth and csrf are unavailable', async () => {
    getCsrfTokenMock.mockResolvedValueOnce('');
    getStoredTokenMock.mockReturnValueOnce({ ok: false, error: 'NOT_FOUND' });
    const connect = vi.fn(async () => {});
    const { connectRealtimeWithCsrf } = await loadModule();

    await expect(connectRealtimeWithCsrf(connect)).rejects.toThrow(
      'Sign in to use realtime voice.'
    );

    expect(connect).not.toHaveBeenCalled();
  });

  it('reuses a prewarmed realtime setup response for the matching SDK setup fetch', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockImplementation(async () =>
      Response.json({ token: 'prewarmed-token', tools: [] })
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf, prewarmRealtimeVoiceSetup } = await loadModule();
    const sessionConfig = { outputModalities: ['audio' as const] };
    const setupBody = JSON.stringify({ sessionConfig });
    let setupPayload: unknown = null;

    prewarmRealtimeVoiceSetup(sessionConfig);
    await connectRealtimeWithCsrf(
      async () => {
        const response = await fetch(REALTIME_SETUP_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: setupBody,
        });
        setupPayload = await response.json();
      },
      { setupBody }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setupPayload).toEqual({ token: 'prewarmed-token', tools: [] });
    const prewarmCall = fetchMock.mock.calls[0];
    if (!prewarmCall) {
      throw new Error('Expected prewarm fetch call');
    }
    expect(prewarmCall[0]).toBe(REALTIME_SETUP_ENDPOINT);
    expect(prewarmCall[1]?.body).toBe(setupBody);
    const prewarmHeaders = new Headers(prewarmCall[1]?.headers);
    expect(prewarmHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(prewarmHeaders.get('authorization')).toBe('Bearer browser-token');
  });

  it('does not reuse a prewarmed realtime setup response after auth changes', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(Response.json({ token: 'prewarmed-token', tools: [] }))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf, prewarmRealtimeVoiceSetup } = await loadModule();
    const sessionConfig = { outputModalities: ['audio' as const] };
    const setupBody = JSON.stringify({ sessionConfig });
    const setupResult: { status: number | null } = { status: null };
    getStoredTokenMock
      .mockReturnValueOnce({ ok: true, value: 'browser-token-before-logout' })
      .mockReturnValue({ ok: false, error: 'NOT_FOUND' });

    prewarmRealtimeVoiceSetup(sessionConfig);
    await connectRealtimeWithCsrf(
      async () => {
        const response = await fetch(REALTIME_SETUP_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: setupBody,
        });
        setupResult.status = response.status;
      },
      { setupBody }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setupResult.status).toBe(401);
    const liveSetupCall = fetchMock.mock.calls[1];
    if (!liveSetupCall) {
      throw new Error('Expected live realtime setup fetch after auth changed');
    }
    expect(liveSetupCall[0]).toBe(REALTIME_SETUP_ENDPOINT);
    const liveHeaders = new Headers(liveSetupCall[1]?.headers);
    expect(liveHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(liveHeaders.get('authorization')).toBeNull();
  });

  it('resolves optimistic browser realtime setup as an active connecting session', async () => {
    const { resolveRealtimeVoiceActivity } = await loadModule();

    expect(
      resolveRealtimeVoiceActivity({
        isConnectionStarting: true,
        realtimeStatus: 'disconnected',
      })
    ).toEqual({
      isActive: true,
      status: 'connecting',
    });
    expect(
      resolveRealtimeVoiceActivity({
        isConnectionStarting: false,
        realtimeStatus: 'disconnected',
      })
    ).toEqual({
      isActive: false,
      status: 'disconnected',
    });
    expect(
      resolveRealtimeVoiceActivity({
        isCapturing: true,
        isConnectionStarting: false,
        realtimeStatus: 'connecting',
      })
    ).toEqual({
      isActive: true,
      status: 'connected',
    });
    expect(
      resolveRealtimeVoiceActivity({
        isConnectionStarting: false,
        realtimeStatus: 'connected',
      })
    ).toEqual({
      isActive: true,
      status: 'connected',
    });
  });

  it('keeps AI SDK realtime identity inputs stable across startup rerenders', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    const connectDeferred = createDeferred<void>();
    const streamDeferred = createDeferred<MediaStream>();
    const realtimeSession = createRealtimeSessionFixture({
      connect: vi.fn(() => connectDeferred.promise),
    });
    experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => streamDeferred.promise),
      },
    });
    const { useRealtimeVoiceSession } = await loadModule();
    const setErrorMessage = vi.fn();

    const { result, unmount } = renderHook(() => useRealtimeVoiceSession({ setErrorMessage }));
    const initialOptions = experimentalUseRealtimeMock.mock.calls.at(-1)?.[0] as {
      api: unknown;
      model: unknown;
      sessionConfig: unknown;
    };
    let connectPromise: Promise<void>;
    await act(async () => {
      connectPromise = result.current.connect();
      await Promise.resolve();
    });
    const startupOptions = experimentalUseRealtimeMock.mock.calls.at(-1)?.[0] as {
      api: unknown;
      model: unknown;
      sessionConfig: unknown;
    };

    expect(startupOptions.model).toBe(initialOptions.model);
    expect(startupOptions.api).toBe(initialOptions.api);
    expect(startupOptions.sessionConfig).toBe(initialOptions.sessionConfig);

    streamDeferred.resolve(stream);
    connectDeferred.resolve();
    await act(async () => {
      await connectPromise;
    });

    unmount();
  });
});
