import { z } from 'zod';

import { getMobileClient } from '../api/client';
import { createModuleLogger } from '../logger';

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
  sessionScope?: 'desktop-local' | 'mobile-control';
  transport: {
    kind: string;
    encoding: string;
  };
  targetDeviceId?: string;
  controllerDeviceId?: string;
  machineName?: string;
};

export type DesktopAppServerEvent = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
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

type RpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

const defaultRpcPath = '/rpc';
const logger = createModuleLogger('DesktopPairingClient');

const logDesktopPairingFailure = (
  message: string,
  metadata: Record<string, unknown> = {}
): void => {
  logger.warn(message, metadata);
};

const transportSchema = z.object({
  kind: z.string().min(1).optional(),
  encoding: z.string().min(1).optional(),
});

const desktopPairingPayloadSchema = z.object({
  baseUrl: z.string().min(1),
  pairingCode: z.string().min(1),
  rpcPath: z.string().min(1).optional(),
  transport: transportSchema.optional(),
});

export const desktopPairingSessionSchema = z.object({
  baseUrl: z.string().min(1),
  rpcPath: z.string().min(1),
  sessionToken: z.string().min(1),
  sessionScope: z.enum(['desktop-local', 'mobile-control']).optional(),
  transport: z.object({
    kind: z.string().min(1),
    encoding: z.string().min(1),
  }),
  targetDeviceId: z.string().min(1).optional(),
  controllerDeviceId: z.string().min(1).optional(),
  machineName: z.string().min(1).optional(),
});

const pairingResponseSchema = z.object({
  sessionToken: z.string().min(1).optional(),
  sessionScope: z.enum(['desktop-local', 'mobile-control']).optional(),
  rpcPath: z.string().min(1).optional(),
  transport: transportSchema.optional(),
});

const eventSnapshotSchema = z.object({
  events: z.array(z.record(z.string(), z.unknown())),
});

const rpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

const rpcResponseSchema = z
  .object({
    result: z.unknown().optional(),
    error: rpcErrorSchema.optional(),
  })
  .refine((value) => value.result !== undefined || value.error !== undefined, {
    message: 'RPC response must include result or error',
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJsonBody = async (response: Response, context: string): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    logDesktopPairingFailure('Desktop pairing response JSON parsing failed', {
      context,
      status: response.status,
      error,
    });
    throw new DesktopPairingError(`${context} response was not valid JSON.`, response.status);
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
    logDesktopPairingFailure('Desktop pairing response validation failed', {
      context,
      status,
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    throw new DesktopPairingError(`${context} response was malformed.`, status);
  }
  return parsed.data;
};

export const callDesktopAppServerRpc = async <T>(
  session: DesktopPairingSession,
  method: string,
  params: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> => {
  if (session.transport.kind === 'relay') {
    return callDesktopRelayRpc<T>(session, method, params);
  }
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
    logDesktopPairingFailure('Desktop request failed', {
      method,
      status: response.status,
      statusText: response.statusText,
    });
    throw new DesktopPairingError(
      `Desktop request failed with status ${response.status}`,
      response.status
    );
  }

  const payload = parseResponseBody(
    await readJsonBody(response, 'Desktop request'),
    rpcResponseSchema,
    'Desktop request',
    response.status
  ) as RpcResponse<T>;
  if (payload.error) {
    logDesktopPairingFailure('Desktop request returned JSON-RPC error', {
      method,
      code: payload.error.code,
      message: payload.error.message,
    });
    throw new DesktopPairingError(
      `Desktop request failed: ${payload.error.code} ${payload.error.message}`
    );
  }
  if (payload.result === undefined) {
    logDesktopPairingFailure('Desktop request response omitted result', { method });
    throw new DesktopPairingError('Desktop request did not return a result.');
  }
  return payload.result;
};

const callDesktopRelayRpc = async <T>(
  session: DesktopPairingSession,
  method: string,
  params: Record<string, unknown>
): Promise<T> => {
  const targetDeviceId = session.targetDeviceId;
  const controllerDeviceId = session.controllerDeviceId;
  if (!targetDeviceId || !controllerDeviceId) {
    throw new DesktopPairingError('Remote connection is missing its device identity.');
  }
  const client = getMobileClient();
  const request = { jsonrpc: '2.0', id: Date.now(), method, params };
  const commandId = await client.enqueueRemoteRpc({
    controllerDeviceId,
    targetDeviceId,
    request,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await client.getRemoteRpcResult({
      controllerDeviceId,
      targetDeviceId,
      commandId,
    });
    if (result.status === 'complete') {
      const payload = rpcResponseSchema.parse(result.response) as RpcResponse<T>;
      if (payload.error) {
        throw new DesktopPairingError(
          `Desktop request failed: ${payload.error.code} ${payload.error.message}`
        );
      }
      if (payload.result === undefined) {
        throw new DesktopPairingError('Desktop request did not return a result.');
      }
      return payload.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new DesktopPairingError('The Mac did not answer the Remote request in time.');
};

export const pairWithRemoteCode = async (input: {
  code: string;
  controllerDeviceId: string;
  controllerName: string;
}): Promise<DesktopPairingSession> => {
  const target = await getMobileClient().pairRemoteDevice({
    deviceId: input.controllerDeviceId,
    deviceName: input.controllerName,
    code: input.code,
  });
  const session: DesktopPairingSession = {
    baseUrl: `https://remote.taskforceai/device/${encodeURIComponent(target.deviceId)}`,
    rpcPath: '/rpc',
    sessionToken: 'account-scoped',
    sessionScope: 'mobile-control',
    transport: { kind: 'relay', encoding: 'json' },
    targetDeviceId: target.deviceId,
    controllerDeviceId: input.controllerDeviceId,
    machineName: target.deviceName,
  };
  await pingDesktopAppServer(session);
  return session;
};

export const parseDesktopPairingPayload = (raw: string): DesktopPairingPayload => {
  const value = raw.trim();
  if (!value) {
    throw new DesktopPairingError('Paste a desktop pairing payload.');
  }

  return value.startsWith('{') ? parseJsonPayload(value) : parseUrlPayload(value);
};

export const pairWithDesktopAppServer = async (
  payload: DesktopPairingPayload,
  fetchImpl: typeof fetch = fetch
): Promise<DesktopPairingSession> => {
  const validPayload = validatePayload(payload);
  const pairingResponse = await fetchImpl(new URL('/pairing', validPayload.baseUrl).toString(), {
    method: 'GET',
    headers: {
      'X-Taskforce-Pairing-Code': validPayload.pairingCode,
      'X-Taskforce-Client': 'mobile',
    },
  });
  if (!pairingResponse.ok) {
    logDesktopPairingFailure('Desktop pairing request failed', {
      status: pairingResponse.status,
      statusText: pairingResponse.statusText,
    });
    throw new DesktopPairingError(
      `Desktop pairing failed with status ${pairingResponse.status}`,
      pairingResponse.status
    );
  }

  const pairing = parseResponseBody(
    await readJsonBody(pairingResponse, 'Desktop pairing'),
    pairingResponseSchema,
    'Desktop pairing',
    pairingResponse.status
  );
  if (!pairing.sessionToken) {
    logDesktopPairingFailure('Desktop pairing response omitted session token', {
      status: pairingResponse.status,
    });
    throw new DesktopPairingError('Desktop pairing response did not include a session.');
  }

  const session: DesktopPairingSession = {
    baseUrl: validPayload.baseUrl,
    rpcPath: normalizeRpcPath(pairing.rpcPath ?? validPayload.rpcPath),
    sessionToken: pairing.sessionToken,
    sessionScope: pairing.sessionScope ?? 'mobile-control',
    transport: {
      kind: pairing.transport?.kind ?? validPayload.transport?.kind ?? 'http',
      encoding: pairing.transport?.encoding ?? validPayload.transport?.encoding ?? 'json',
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

export const revokeDesktopPairingSession = async (
  session: DesktopPairingSession,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  if (session.transport.kind === 'relay') return;
  const response = await fetchImpl(new URL('/session', session.baseUrl).toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  if (!response.ok && response.status !== 401) {
    throw new DesktopPairingError(
      `Desktop disconnect failed with status ${response.status}`,
      response.status
    );
  }
};

export const registerDesktopRemotePushToken = async (
  session: DesktopPairingSession,
  expoPushToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  if (session.transport.kind === 'relay') return;
  const response = await fetchImpl(new URL('/mobile-notifications', session.baseUrl).toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expoPushToken }),
  });
  if (!response.ok) {
    throw new DesktopPairingError(
      `Desktop notification registration failed with status ${response.status}`,
      response.status
    );
  }
};

export const unregisterDesktopRemotePushToken = async (
  session: DesktopPairingSession,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  if (session.transport.kind === 'relay') return;
  const response = await fetchImpl(new URL('/mobile-notifications', session.baseUrl).toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  if (!response.ok && response.status !== 401) {
    throw new DesktopPairingError(
      `Desktop notification removal failed with status ${response.status}`,
      response.status
    );
  }
};

export const listDesktopAppServerEvents = async (
  session: DesktopPairingSession,
  fetchImpl: typeof fetch = fetch
): Promise<DesktopAppServerEvent[]> => {
  if (session.transport.kind === 'relay') {
    const snapshot = await callDesktopAppServerRpc<{ events: DesktopAppServerEvent[] }>(
      session,
      'remote.event.snapshot'
    );
    return eventSnapshotSchema.parse(snapshot).events;
  }
  const response = await fetchImpl(new URL('/events/snapshot', session.baseUrl).toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  if (!response.ok) {
    throw new DesktopPairingError(
      `Desktop events failed with status ${response.status}`,
      response.status
    );
  }
  return parseResponseBody(
    await readJsonBody(response, 'Desktop events'),
    eventSnapshotSchema,
    'Desktop events',
    response.status
  ).events;
};

export const respondToDesktopAppServerRequest = async (
  session: DesktopPairingSession,
  requestId: number | string,
  result: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  if (session.transport.kind === 'relay') {
    await callDesktopAppServerRpc<{ ok: boolean }>(session, 'remote.interaction.respond', {
      requestId,
      result,
    });
    return;
  }
  const response = await fetchImpl(resolveRpcUrl(session.baseUrl, session.rpcPath), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, result }),
  });
  if (!response.ok) {
    throw new DesktopPairingError(
      `Desktop interaction response failed with status ${response.status}`,
      response.status
    );
  }
};

const parseJsonPayload = (value: string): DesktopPairingPayload => {
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(value);
  } catch {
    throw new DesktopPairingError('Desktop pairing payload is not valid JSON.');
  }
  return parseRawPayload(rawPayload);
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
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(encodedPayload);
    } catch {
      throw new DesktopPairingError('Desktop pairing link payload is not valid JSON.');
    }
    return parseRawPayload(rawPayload);
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

const parseRawPayload = (payload: unknown): DesktopPairingPayload => validatePayload(payload);

const validatePayload = (payload: unknown): DesktopPairingPayload => {
  if (!isRecord(payload)) {
    throw new DesktopPairingError('Desktop pairing payload must be an object.');
  }
  if (typeof payload.baseUrl !== 'string' || payload.baseUrl.trim().length === 0) {
    throw new DesktopPairingError('Desktop pairing payload is missing baseUrl.');
  }
  if (typeof payload.pairingCode !== 'string' || payload.pairingCode.trim().length === 0) {
    throw new DesktopPairingError('Desktop pairing payload is missing pairingCode.');
  }
  const parsed = desktopPairingPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logDesktopPairingFailure('Desktop pairing payload validation failed', {
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    throw new DesktopPairingError('Desktop pairing payload is malformed.');
  }
  const validPayload = parsed.data;
  let url: URL;
  try {
    url = new URL(validPayload.baseUrl);
  } catch {
    throw new DesktopPairingError('Desktop pairing baseUrl is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DesktopPairingError('Desktop pairing baseUrl must use http or https.');
  }
  normalizeRpcPath(validPayload.rpcPath);
  return validPayload;
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
