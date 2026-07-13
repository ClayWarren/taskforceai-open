import { describe, expect, it, mock } from 'bun:test';

import {
  DesktopHttpAppServerError,
  callDesktopHttpRpc,
  createDesktopHttpPairingDeepLink,
  mintDesktopHttpPairingInfo,
  pairDesktopHttpAppServer,
  pingDesktopHttpAppServer,
  serializeDesktopHttpPairingPayload,
  type DesktopHttpAppServerSession,
} from './http-app-server';
import type { AppServerHttpPairingInfo } from './app-server-types';

const pairingInfo: AppServerHttpPairingInfo = {
  baseUrl: 'http://127.0.0.1:7319',
  pairingCode: 'pair-me',
  rpcPath: '/rpc',
  transport: {
    kind: 'http',
    encoding: 'json',
  },
};

const session: DesktopHttpAppServerSession = {
  baseUrl: 'http://127.0.0.1:7319',
  sessionToken: 'session-token',
  rpcPath: '/rpc',
  transport: {
    kind: 'http',
    encoding: 'json',
  },
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });

describe('desktop http app-server client', () => {
  it('exchanges pairing info for a session token', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        jsonResponse({
          sessionToken: 'session-token',
          rpcPath: '/rpc',
          transport: { kind: 'http', encoding: 'json' },
        })
      )
    );

    const result = await pairDesktopHttpAppServer(pairingInfo, { fetch: fetchMock });

    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7319/pairing', {
      method: 'GET',
      headers: {
        'X-Taskforce-Pairing-Code': 'pair-me',
      },
    });
  });

  it('reports failed or already-used pairing codes', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ error: 'invalid pairing code' }, { status: 403 }))
    );

    await expect(pairDesktopHttpAppServer(pairingInfo, { fetch: fetchMock })).rejects.toThrow(
      'app-server pairing failed with status 403'
    );
  });

  it('rejects malformed pairing responses', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ rpcPath: '/rpc' })));

    await expect(pairDesktopHttpAppServer(pairingInfo, { fetch: fetchMock })).rejects.toThrow(
      'app-server pairing response did not include a session'
    );
  });

  it('wraps invalid pairing JSON in an app-server error', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      )
    );

    try {
      await pairDesktopHttpAppServer(pairingInfo, { fetch: fetchMock });
      throw new Error('expected pairing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopHttpAppServerError);
      expect((error as Error).message).toContain('app-server pairing response was not valid JSON');
      expect((error as DesktopHttpAppServerError).status).toBe(200);
    }
  });

  it('rejects malformed pairing code responses', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        jsonResponse({ pairingCode: '', transport: { kind: 'http', encoding: 'json' } })
      )
    );

    await expect(mintDesktopHttpPairingInfo(session, { fetch: fetchMock })).rejects.toThrow(
      'app-server pairing code response was malformed'
    );
  });

  it('calls authenticated JSON-RPC methods', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } }))
    );

    const result = await pingDesktopHttpAppServer(session, { fetch: fetchMock });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7319/rpc', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server.ping',
        params: {},
      }),
    });
  });

  it('mints fresh pairing info from an authenticated session', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        jsonResponse({
          pairingCode: 'fresh-code',
          rpcPath: '/rpc',
          transport: { kind: 'http', encoding: 'json' },
        })
      )
    );

    const result = await mintDesktopHttpPairingInfo(session, { fetch: fetchMock });

    expect(result).toEqual({
      baseUrl: 'http://127.0.0.1:7319',
      pairingCode: 'fresh-code',
      rpcPath: '/rpc',
      transport: { kind: 'http', encoding: 'json' },
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7319/pairing-code', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
      },
    });
  });

  it('serializes desktop pairing payloads for mobile', () => {
    expect(serializeDesktopHttpPairingPayload(pairingInfo)).toBe(
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:7319',
        pairingCode: 'pair-me',
        rpcPath: '/rpc',
        transport: { kind: 'http', encoding: 'json' },
      })
    );

    const link = createDesktopHttpPairingDeepLink(pairingInfo);
    expect(link.startsWith('taskforceai://desktop-pairing?payload=')).toBe(true);
    expect(new URL(link).searchParams.get('payload')).toBe(
      serializeDesktopHttpPairingPayload(pairingInfo)
    );
  });

  it('surfaces JSON-RPC errors', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        })
      )
    );

    await expect(
      callDesktopHttpRpc(session, 'run.submit', {}, { fetch: fetchMock })
    ).rejects.toThrow('app-server rpc error -32601: Method not found');
  });

  it('rejects malformed JSON-RPC envelopes', async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1 })));

    await expect(
      callDesktopHttpRpc(session, 'server.ping', {}, { fetch: fetchMock })
    ).rejects.toThrow('app-server rpc response was malformed');
  });

  it('keeps HTTP status on network API errors', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ error: 'session token required' }, { status: 401 }))
    );

    try {
      await callDesktopHttpRpc(session, 'server.ping', {}, { fetch: fetchMock });
      throw new Error('expected rpc call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopHttpAppServerError);
      expect((error as DesktopHttpAppServerError).status).toBe(401);
    }
  });
});
