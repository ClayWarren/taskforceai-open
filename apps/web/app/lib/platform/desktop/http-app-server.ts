import type { AppServerHttpPairingInfo } from './app-server-types';

export type DesktopHttpAppServerSession = {
  baseUrl: string;
  sessionToken: string;
  rpcPath: string;
  transport: {
    kind: string;
    encoding: string;
  };
};

export type JsonRpcResponse<T> = {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

export type DesktopHttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DesktopHttpClientOptions = {
  fetch?: DesktopHttpFetch;
};

type PairingResponse = {
  sessionToken?: string;
  rpcPath?: string;
  transport?: {
    kind?: string;
    encoding?: string;
  };
};

type PairingCodeResponse = {
  pairingCode?: string;
  rpcPath?: string;
  transport?: {
    kind?: string;
    encoding?: string;
  };
};

const defaultRpcPath = '/rpc';

export class DesktopHttpAppServerError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'DesktopHttpAppServerError';
  }
}

export const pairDesktopHttpAppServer = async (
  info: AppServerHttpPairingInfo,
  options: DesktopHttpClientOptions = {}
): Promise<DesktopHttpAppServerSession> => {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(pairingUrl(info), {
    method: 'GET',
    headers: {
      'X-Taskforce-Pairing-Code': info.pairingCode,
    },
  });
  if (!response.ok) {
    throw new DesktopHttpAppServerError(
      `app-server pairing failed with status ${response.status}`,
      response.status
    );
  }

  const payload = (await response.json()) as PairingResponse;
  if (!payload.sessionToken) {
    throw new DesktopHttpAppServerError('app-server pairing response did not include a session');
  }

  return {
    baseUrl: info.baseUrl,
    sessionToken: payload.sessionToken,
    rpcPath: payload.rpcPath ?? info.rpcPath ?? defaultRpcPath,
    transport: {
      kind: payload.transport?.kind ?? info.transport.kind,
      encoding: payload.transport?.encoding ?? info.transport.encoding,
    },
  };
};

export const mintDesktopHttpPairingInfo = async (
  session: DesktopHttpAppServerSession,
  options: DesktopHttpClientOptions = {}
): Promise<AppServerHttpPairingInfo> => {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(new URL('/pairing-code', session.baseUrl).toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
    },
  });
  if (!response.ok) {
    throw new DesktopHttpAppServerError(
      `app-server pairing code mint failed with status ${response.status}`,
      response.status
    );
  }

  const payload = (await response.json()) as PairingCodeResponse;
  if (!payload.pairingCode) {
    throw new DesktopHttpAppServerError('app-server pairing code response did not include a code');
  }

  return {
    baseUrl: session.baseUrl,
    pairingCode: payload.pairingCode,
    rpcPath: payload.rpcPath ?? session.rpcPath ?? defaultRpcPath,
    transport: {
      kind: payload.transport?.kind ?? session.transport.kind,
      encoding: payload.transport?.encoding ?? session.transport.encoding,
    },
  };
};

export const serializeDesktopHttpPairingPayload = (info: AppServerHttpPairingInfo): string =>
  JSON.stringify({
    baseUrl: info.baseUrl,
    pairingCode: info.pairingCode,
    rpcPath: info.rpcPath,
    transport: info.transport,
  });

export const createDesktopHttpPairingDeepLink = (info: AppServerHttpPairingInfo): string => {
  const url = new URL('taskforceai://desktop-pairing');
  url.searchParams.set('payload', serializeDesktopHttpPairingPayload(info));
  return url.toString();
};

export const callDesktopHttpRpc = async <T>(
  session: DesktopHttpAppServerSession,
  method: string,
  params: unknown = {},
  options: DesktopHttpClientOptions = {}
): Promise<T> => {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(rpcUrl(session), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new DesktopHttpAppServerError(
      `app-server rpc failed with status ${response.status}`,
      response.status
    );
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new DesktopHttpAppServerError(
      `app-server rpc error ${payload.error.code}: ${payload.error.message}`
    );
  }
  if (!('result' in payload)) {
    throw new DesktopHttpAppServerError('app-server rpc response did not include a result');
  }
  return payload.result as T;
};

export const initializeDesktopHttpAppServer = (
  session: DesktopHttpAppServerSession,
  options?: DesktopHttpClientOptions
) => callDesktopHttpRpc(session, 'initialize', {}, options);

export const pingDesktopHttpAppServer = (
  session: DesktopHttpAppServerSession,
  options?: DesktopHttpClientOptions
) => callDesktopHttpRpc<{ ok: boolean }>(session, 'server.ping', {}, options);

const pairingUrl = (info: AppServerHttpPairingInfo) => new URL('/pairing', info.baseUrl).toString();

const rpcUrl = (session: DesktopHttpAppServerSession) =>
  new URL(session.rpcPath || defaultRpcPath, session.baseUrl).toString();
