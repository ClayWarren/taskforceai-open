import { z } from 'zod';

import { logger } from '@taskforceai/web/app/lib/logger';
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

type JsonRpcResponse<T> = {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type DesktopHttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DesktopHttpClientOptions = {
  fetch?: DesktopHttpFetch;
};

const defaultRpcPath = '/rpc';

const transportSchema = z.object({
  kind: z.string().min(1).optional(),
  encoding: z.string().min(1).optional(),
});

const pairingResponseSchema = z.object({
  sessionToken: z.string().min(1).optional(),
  rpcPath: z.string().min(1).optional(),
  transport: transportSchema.optional(),
});

const pairingCodeResponseSchema = z.object({
  pairingCode: z.string().min(1).optional(),
  rpcPath: z.string().min(1).optional(),
  transport: transportSchema.optional(),
});

const jsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

const jsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.number(), z.string(), z.null()]).optional(),
    result: z.unknown().optional(),
    error: jsonRpcErrorSchema.optional(),
  })
  .refine((value) => value.result !== undefined || value.error !== undefined, {
    message: 'JSON-RPC response must include result or error',
  });

export class DesktopHttpAppServerError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'DesktopHttpAppServerError';
  }
}

const logDesktopHttpClientFailure = (
  message: string,
  metadata: Record<string, unknown> = {}
): void => {
  logger.warn(message, { component: 'desktop-http-app-server', ...metadata });
};

const readJsonBody = async (response: Response, context: string): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    logDesktopHttpClientFailure('Desktop app-server response JSON parsing failed', {
      context,
      status: response.status,
      error,
    });
    throw new DesktopHttpAppServerError(
      `${context} response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      response.status
    );
  }
};

const parseResponseBody = <T>(
  rawBody: unknown,
  schema: z.ZodType<T>,
  context: string,
  status: number
): T => {
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    logDesktopHttpClientFailure('Desktop app-server response validation failed', {
      context,
      status,
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    throw new DesktopHttpAppServerError(`${context} response was malformed`, status);
  }
  return parsed.data;
};

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
    logDesktopHttpClientFailure('Desktop app-server pairing request failed', {
      status: response.status,
      statusText: response.statusText,
    });
    throw new DesktopHttpAppServerError(
      `app-server pairing failed with status ${response.status}`,
      response.status
    );
  }

  const payload = parseResponseBody(
    await readJsonBody(response, 'app-server pairing'),
    pairingResponseSchema,
    'app-server pairing',
    response.status
  );
  if (!payload.sessionToken) {
    logDesktopHttpClientFailure('Desktop app-server pairing response omitted session token', {
      status: response.status,
    });
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
    logDesktopHttpClientFailure('Desktop app-server pairing-code request failed', {
      status: response.status,
      statusText: response.statusText,
    });
    throw new DesktopHttpAppServerError(
      `app-server pairing code mint failed with status ${response.status}`,
      response.status
    );
  }

  const payload = parseResponseBody(
    await readJsonBody(response, 'app-server pairing code'),
    pairingCodeResponseSchema,
    'app-server pairing code',
    response.status
  );
  if (!payload.pairingCode) {
    logDesktopHttpClientFailure('Desktop app-server pairing-code response omitted code', {
      status: response.status,
    });
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
    logDesktopHttpClientFailure('Desktop app-server RPC request failed', {
      method,
      status: response.status,
      statusText: response.statusText,
    });
    throw new DesktopHttpAppServerError(
      `app-server rpc failed with status ${response.status}`,
      response.status
    );
  }

  const payload = parseResponseBody(
    await readJsonBody(response, 'app-server rpc'),
    jsonRpcResponseSchema,
    'app-server rpc',
    response.status
  ) as JsonRpcResponse<T>;
  if (payload.error) {
    logDesktopHttpClientFailure('Desktop app-server RPC returned JSON-RPC error', {
      method,
      code: payload.error.code,
      message: payload.error.message,
    });
    throw new DesktopHttpAppServerError(
      `app-server rpc error ${payload.error.code}: ${payload.error.message}`
    );
  }
  if (!('result' in payload)) {
    logDesktopHttpClientFailure('Desktop app-server RPC response omitted result', { method });
    throw new DesktopHttpAppServerError('app-server rpc response did not include a result');
  }
  return payload.result as T;
};

export const pingDesktopHttpAppServer = (
  session: DesktopHttpAppServerSession,
  options?: DesktopHttpClientOptions
) => callDesktopHttpRpc<{ ok: boolean }>(session, 'server.ping', {}, options);

const pairingUrl = (info: AppServerHttpPairingInfo) => new URL('/pairing', info.baseUrl).toString();

const rpcUrl = (session: DesktopHttpAppServerSession) =>
  new URL(session.rpcPath || defaultRpcPath, session.baseUrl).toString();
