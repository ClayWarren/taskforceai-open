export type DesktopPairingPayload = {
  baseUrl: string;
  pairingCode: string;
  rpcPath?: string;
  transport?: {
    kind?: string;
    encoding?: string;
  };
};

export type DesktopPairingSession = {
  baseUrl: string;
  rpcPath: string;
  sessionToken: string;
  transport: {
    kind: string;
    encoding: string;
  };
};

export class DesktopPairingError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'DesktopPairingError';
  }
}

type PairingResponse = {
  sessionToken?: string;
  rpcPath?: string;
  transport?: {
    kind?: string;
    encoding?: string;
  };
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

const defaultRpcPath = '/rpc';

export const callDesktopAppServerRpc = async <T>(
  session: DesktopPairingSession,
  method: string,
  params: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> => {
  const response = await fetchImpl(resolveRpcUrl(session.baseUrl, session.rpcPath), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new DesktopPairingError(
      `Desktop request failed with status ${response.status}`,
      response.status
    );
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    throw new DesktopPairingError(
      `Desktop request failed: ${payload.error.code} ${payload.error.message}`
    );
  }
  if (payload.result === undefined) {
    throw new DesktopPairingError('Desktop request did not return a result.');
  }
  return payload.result;
};

export const parseDesktopPairingPayload = (raw: string): DesktopPairingPayload => {
  const value = raw.trim();
  if (!value) {
    throw new DesktopPairingError('Paste a desktop pairing payload.');
  }

  const parsed = value.startsWith('{') ? parseJsonPayload(value) : parseUrlPayload(value);
  validatePayload(parsed);
  return parsed;
};

export const pairWithDesktopAppServer = async (
  payload: DesktopPairingPayload,
  fetchImpl: typeof fetch = fetch
): Promise<DesktopPairingSession> => {
  validatePayload(payload);
  const pairingResponse = await fetchImpl(new URL('/pairing', payload.baseUrl).toString(), {
    method: 'GET',
    headers: {
      'X-Taskforce-Pairing-Code': payload.pairingCode,
    },
  });
  if (!pairingResponse.ok) {
    throw new DesktopPairingError(
      `Desktop pairing failed with status ${pairingResponse.status}`,
      pairingResponse.status
    );
  }

  const pairing = (await pairingResponse.json()) as PairingResponse;
  if (!pairing.sessionToken) {
    throw new DesktopPairingError('Desktop pairing response did not include a session.');
  }

  const session: DesktopPairingSession = {
    baseUrl: payload.baseUrl,
    rpcPath: normalizeRpcPath(pairing.rpcPath ?? payload.rpcPath),
    sessionToken: pairing.sessionToken,
    transport: {
      kind: pairing.transport?.kind ?? payload.transport?.kind ?? 'http',
      encoding: pairing.transport?.encoding ?? payload.transport?.encoding ?? 'json',
    },
  };
  await pingDesktopAppServer(session, fetchImpl);
  return session;
};

export const pingDesktopAppServer = async (
  session: DesktopPairingSession,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean }> => {
  const result = await callDesktopAppServerRpc<{ ok: boolean }>(
    session,
    'server.ping',
    {},
    fetchImpl
  );
  if (!result.ok) {
    throw new DesktopPairingError('Desktop ping did not return ok.');
  }
  return result;
};

const parseJsonPayload = (value: string): DesktopPairingPayload => {
  try {
    return JSON.parse(value) as DesktopPairingPayload;
  } catch {
    throw new DesktopPairingError('Desktop pairing payload is not valid JSON.');
  }
};

const parseUrlPayload = (value: string): DesktopPairingPayload => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DesktopPairingError('Desktop pairing payload is not a valid link.');
  }
  const encodedPayload = url.searchParams.get('payload');
  if (encodedPayload) {
    try {
      return JSON.parse(encodedPayload) as DesktopPairingPayload;
    } catch {
      throw new DesktopPairingError('Desktop pairing link payload is not valid JSON.');
    }
  }
  return {
    baseUrl: url.searchParams.get('baseUrl') ?? '',
    pairingCode: url.searchParams.get('pairingCode') ?? '',
    rpcPath: url.searchParams.get('rpcPath') ?? undefined,
    transport: {
      kind: url.searchParams.get('transportKind') ?? undefined,
      encoding: url.searchParams.get('transportEncoding') ?? undefined,
    },
  };
};

const validatePayload = (payload: DesktopPairingPayload) => {
  if (!payload.baseUrl) {
    throw new DesktopPairingError('Desktop pairing payload is missing baseUrl.');
  }
  if (!payload.pairingCode) {
    throw new DesktopPairingError('Desktop pairing payload is missing pairingCode.');
  }
  let url: URL;
  try {
    url = new URL(payload.baseUrl);
  } catch {
    throw new DesktopPairingError('Desktop pairing baseUrl is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DesktopPairingError('Desktop pairing baseUrl must use http or https.');
  }
  normalizeRpcPath(payload.rpcPath);
};

export const isPlainHttpDesktopPairingPayload = (payload: DesktopPairingPayload): boolean => {
  try {
    return new URL(payload.baseUrl).protocol === 'http:';
  } catch {
    return false;
  }
};

const resolveRpcUrl = (baseUrl: string, rpcPath: string): string =>
  new URL(normalizeRpcPath(rpcPath), baseUrl).toString();

const normalizeRpcPath = (path: string | undefined): string => {
  const value = path?.trim() || defaultRpcPath;
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new DesktopPairingError('Desktop pairing RPC path must be relative to the paired app.');
  }
  let url: URL;
  try {
    url = new URL(value, 'http://desktop.local');
  } catch {
    throw new DesktopPairingError('Desktop pairing RPC path is invalid.');
  }
  if (url.origin !== 'http://desktop.local' || url.hash) {
    throw new DesktopPairingError('Desktop pairing RPC path must be relative to the paired app.');
  }
  return `${url.pathname}${url.search}`;
};
