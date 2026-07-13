import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  callDesktopAppServerRpc,
  DesktopPairingError,
  isPlainHttpDesktopPairingPayload,
  listDesktopAppServerEvents,
  pairWithDesktopAppServer,
  parseDesktopPairingPayload,
  revokeDesktopPairingSession,
  registerDesktopRemotePushToken,
  unregisterDesktopRemotePushToken,
  respondToDesktopAppServerRequest,
} from '../../desktop-pairing/client';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('desktop pairing client', () => {
  const originalWarn = console.warn;

  beforeEach(() => {
    console.warn = mock(() => undefined) as typeof console.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('parses JSON payloads', () => {
    const payload = parseDesktopPairingPayload(
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:7319',
        pairingCode: 'pair-me',
        rpcPath: '/rpc',
        transport: { kind: 'http', encoding: 'json' },
      })
    );

    expect(payload.baseUrl).toBe('http://127.0.0.1:7319');
    expect(payload.pairingCode).toBe('pair-me');
    expect(isPlainHttpDesktopPairingPayload(payload)).toBe(true);
  });

  it('parses deep-link query payloads', () => {
    const payload = parseDesktopPairingPayload(
      'taskforceai://desktop-pairing?baseUrl=http%3A%2F%2F192.168.1.2%3A7319&pairingCode=pair-me&rpcPath=%2Frpc&transportKind=http&transportEncoding=json'
    );

    expect(payload).toEqual({
      baseUrl: 'http://192.168.1.2:7319',
      pairingCode: 'pair-me',
      rpcPath: '/rpc',
      transport: { kind: 'http', encoding: 'json' },
    });
  });

  it('parses generated desktop payload links', () => {
    const generatedPayload = JSON.stringify({
      baseUrl: 'http://127.0.0.1:7319',
      pairingCode: 'fresh-code',
      rpcPath: '/rpc',
      transport: { kind: 'http', encoding: 'json' },
    });
    const link = new URL('taskforceai://desktop-pairing');
    link.searchParams.set('payload', generatedPayload);

    expect(parseDesktopPairingPayload(link.toString())).toEqual({
      baseUrl: 'http://127.0.0.1:7319',
      pairingCode: 'fresh-code',
      rpcPath: '/rpc',
      transport: { kind: 'http', encoding: 'json' },
    });
  });

  it('rejects invalid payloads', () => {
    expect(() => parseDesktopPairingPayload('')).toThrow('Paste a desktop pairing payload.');
    const link = new URL('taskforceai://desktop-pairing');
    link.searchParams.set('payload', 'null');
    expect(() => parseDesktopPairingPayload(link.toString())).toThrow(
      'Desktop pairing payload must be an object.'
    );
    expect(() =>
      parseDesktopPairingPayload(JSON.stringify({ baseUrl: 'file:///tmp/app', pairingCode: 'x' }))
    ).toThrow('Desktop pairing baseUrl must use http or https.');
    expect(() =>
      parseDesktopPairingPayload(
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:7319',
          pairingCode: 'x',
          rpcPath: 'https://attacker.example/rpc',
        })
      )
    ).toThrow('Desktop pairing RPC path must be relative to the paired app.');
  });

  it('rejects malformed JSON payload fields before pairing', () => {
    expect(() =>
      parseDesktopPairingPayload(
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:7319',
          pairingCode: 'pair-me',
          transport: 'http',
        })
      )
    ).toThrow('Desktop pairing payload is malformed.');

    const link = new URL('taskforceai://desktop-pairing');
    link.searchParams.set(
      'payload',
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:7319',
        pairingCode: 'pair-me',
        rpcPath: 42,
      })
    );
    expect(() => parseDesktopPairingPayload(link.toString())).toThrow(
      'Desktop pairing payload is malformed.'
    );
  });

  it('pairs and pings the desktop app-server', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      if (url.endsWith('/pairing')) {
        expect(init?.headers).toEqual({
          'X-Taskforce-Pairing-Code': 'pair-me',
          'X-Taskforce-Client': 'mobile',
        });
        return Promise.resolve(
          jsonResponse({
            sessionToken: 'session-token',
            rpcPath: '/rpc',
            transport: { kind: 'http', encoding: 'json' },
          })
        );
      }
      expect(url).toBe('http://127.0.0.1:7319/rpc');
      expect(init?.headers).toEqual({
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      });
      return Promise.resolve(jsonResponse({ result: { ok: true } }));
    });

    const session = await pairWithDesktopAppServer(
      {
        baseUrl: 'http://127.0.0.1:7319',
        pairingCode: 'pair-me',
      },
      fetchMock as typeof fetch
    );

    expect(session.sessionToken).toBe('session-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects cross-origin RPC paths from pairing responses', async () => {
    const fetchMock = mock((url: string) => {
      if (url.endsWith('/pairing')) {
        return Promise.resolve(
          jsonResponse({
            sessionToken: 'session-token',
            rpcPath: 'https://attacker.example/rpc',
          })
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(
      pairWithDesktopAppServer(
        { baseUrl: 'http://127.0.0.1:7319', pairingCode: 'pair-me' },
        fetchMock as typeof fetch
      )
    ).rejects.toThrow('Desktop pairing RPC path must be relative to the paired app.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps invalid desktop pairing JSON in a pairing error', async () => {
    const fetchMock = mock((url: string) => {
      if (url.endsWith('/pairing')) {
        return Promise.resolve(new Response('not-json', { status: 200 }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    try {
      await pairWithDesktopAppServer(
        { baseUrl: 'http://127.0.0.1:7319', pairingCode: 'pair-me' },
        fetchMock as typeof fetch
      );
      throw new Error('expected pairing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopPairingError);
      expect((error as Error).message).toBe('Desktop pairing response was not valid JSON.');
      expect((error as DesktopPairingError).status).toBe(200);
    }
  });

  it('calls authenticated desktop JSON-RPC methods', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:7319/rpc');
      expect(init?.headers).toEqual({
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init?.body as string)).toMatchObject({
        jsonrpc: '2.0',
        method: 'thread.list',
        params: {},
      });
      return Promise.resolve(jsonResponse({ result: { threads: [] } }));
    });

    await expect(
      callDesktopAppServerRpc<{ threads: unknown[] }>(
        {
          baseUrl: 'http://127.0.0.1:7319',
          rpcPath: '/rpc',
          sessionToken: 'session-token',
          transport: { kind: 'http', encoding: 'json' },
        },
        'thread.list',
        {},
        fetchMock as typeof fetch
      )
    ).resolves.toEqual({ threads: [] });
  });

  it('revokes the paired mobile session on disconnect', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:7319/session');
      expect(init).toMatchObject({
        method: 'DELETE',
        headers: { Authorization: 'Bearer session-token' },
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await expect(
      revokeDesktopPairingSession(
        {
          baseUrl: 'http://127.0.0.1:7319',
          rpcPath: '/rpc',
          sessionToken: 'session-token',
          sessionScope: 'mobile-control',
          transport: { kind: 'http', encoding: 'json' },
        },
        fetchMock as typeof fetch
      )
    ).resolves.toBeUndefined();
  });

  it('registers Remote push notifications under the scoped mobile session', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:7319/mobile-notifications');
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          Authorization: 'Bearer session-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expoPushToken: 'ExponentPushToken[device]' }),
      });
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    await expect(
      registerDesktopRemotePushToken(
        {
          baseUrl: 'http://127.0.0.1:7319',
          rpcPath: '/rpc',
          sessionToken: 'session-token',
          sessionScope: 'mobile-control',
          transport: { kind: 'http', encoding: 'json' },
        },
        'ExponentPushToken[device]',
        fetchMock as typeof fetch
      )
    ).resolves.toBeUndefined();
  });

  it('removes Remote push notifications from the paired desktop', async () => {
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      expect(init).toMatchObject({
        method: 'DELETE',
        headers: { Authorization: 'Bearer session-token' },
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    await expect(
      unregisterDesktopRemotePushToken(
        {
          baseUrl: 'http://127.0.0.1:7319',
          rpcPath: '/rpc',
          sessionToken: 'session-token',
          transport: { kind: 'http', encoding: 'json' },
        },
        fetchMock as typeof fetch
      )
    ).resolves.toBeUndefined();
  });

  it('reads interaction events and posts approval responses', async () => {
    const session = {
      baseUrl: 'http://127.0.0.1:7319',
      rpcPath: '/rpc',
      sessionToken: 'session-token',
      sessionScope: 'mobile-control' as const,
      transport: { kind: 'http', encoding: 'json' },
    };
    const fetchMock = mock((url: string, init?: RequestInit) => {
      if (url.endsWith('/events/snapshot')) {
        expect(init?.headers).toEqual({ Authorization: 'Bearer session-token' });
        return Promise.resolve(
          jsonResponse({
            events: [
              {
                jsonrpc: '2.0',
                id: 41,
                method: 'item/permissions/requestApproval',
                params: { threadId: 'thread-1', reason: 'Run command' },
              },
            ],
          })
        );
      }
      expect(url).toBe('http://127.0.0.1:7319/rpc');
      expect(JSON.parse(init?.body as string)).toEqual({
        jsonrpc: '2.0',
        id: 41,
        result: { decision: 'accept' },
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const events = await listDesktopAppServerEvents(session, fetchMock as typeof fetch);
    expect(events[0]?.method).toBe('item/permissions/requestApproval');
    await expect(
      respondToDesktopAppServerRequest(
        session,
        41,
        { decision: 'accept' },
        fetchMock as typeof fetch
      )
    ).resolves.toBeUndefined();
  });

  it('rejects malformed desktop JSON-RPC responses', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ id: 1 })));

    await expect(
      callDesktopAppServerRpc<{ threads: unknown[] }>(
        {
          baseUrl: 'http://127.0.0.1:7319',
          rpcPath: '/rpc',
          sessionToken: 'session-token',
          transport: { kind: 'http', encoding: 'json' },
        },
        'thread.list',
        {},
        fetchMock as typeof fetch
      )
    ).rejects.toThrow('Desktop request response was malformed.');
  });

  it('rejects cross-origin RPC paths from stored sessions', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ result: { threads: [] } })));

    await expect(
      callDesktopAppServerRpc<{ threads: unknown[] }>(
        {
          baseUrl: 'http://127.0.0.1:7319',
          rpcPath: '//attacker.example/rpc',
          sessionToken: 'session-token',
          transport: { kind: 'http', encoding: 'json' },
        },
        'thread.list',
        {},
        fetchMock as typeof fetch
      )
    ).rejects.toThrow('Desktop pairing RPC path must be relative to the paired app.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces pairing failures with status', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ error: 'invalid' }, { status: 403 }))
    );

    try {
      await pairWithDesktopAppServer(
        { baseUrl: 'http://127.0.0.1:7319', pairingCode: 'pair-me' },
        fetchMock as typeof fetch
      );
      throw new Error('expected pairing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopPairingError);
      expect((error as DesktopPairingError).status).toBe(403);
    }
  });
});
