import { describe, expect, it, mock } from 'bun:test';

import {
  callDesktopAppServerRpc,
  DesktopPairingError,
  isPlainHttpDesktopPairingPayload,
  pairWithDesktopAppServer,
  parseDesktopPairingPayload,
} from '../../desktop-pairing/client';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('desktop pairing client', () => {
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

  it('pairs and pings the desktop app-server', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      if (url.endsWith('/pairing')) {
        expect(init?.headers).toEqual({ 'X-Taskforce-Pairing-Code': 'pair-me' });
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
    const fetchMock = mock(() => Promise.resolve(jsonResponse({ error: 'invalid' }, { status: 403 })));

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
