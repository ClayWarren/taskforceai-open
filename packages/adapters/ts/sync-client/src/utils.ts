import type { Result } from '@taskforceai/client-core/result';
import type { BroadcastEvent } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: Record<string, unknown>, key: string): string | null => {
  const field = value[key];
  return typeof field === 'string' ? field : null;
};

const readNumber = (value: Record<string, unknown>, key: string): number | null => {
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
};

const parseSyncRequired = (
  value: Record<string, unknown>
): Result<BroadcastEvent, 'INVALID_SCHEMA'> => {
  const userId = value['userId'];
  if (userId === undefined) {
    return { ok: true, value: { type: 'sync:required' } };
  }
  return typeof userId === 'string'
    ? { ok: true, value: { type: 'sync:required', userId } }
    : { ok: false, error: 'INVALID_SCHEMA' };
};

export const parseBroadcastEventPayload = (
  value: unknown
): Result<BroadcastEvent, 'INVALID_SCHEMA'> => {
  if (!isRecord(value)) {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  const type = readString(value, 'type');
  if (!type) {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  switch (type) {
    case 'connected': {
      const connectionId = readString(value, 'connectionId');
      return connectionId
        ? { ok: true, value: { type, connectionId } }
        : { ok: false, error: 'INVALID_SCHEMA' };
    }
    case 'conversation:created':
    case 'conversation:updated':
    case 'conversation:deleted': {
      const userId = readString(value, 'userId');
      const conversationId = readNumber(value, 'conversationId');
      return userId && conversationId !== null
        ? { ok: true, value: { type, userId, conversationId } }
        : { ok: false, error: 'INVALID_SCHEMA' };
    }
    case 'message:created':
    case 'message:updated': {
      const userId = readString(value, 'userId');
      const conversationId = readNumber(value, 'conversationId');
      const messageId = readString(value, 'messageId');
      return userId && conversationId !== null && messageId
        ? { ok: true, value: { type, userId, conversationId, messageId } }
        : { ok: false, error: 'INVALID_SCHEMA' };
    }
    case 'message:deleted': {
      const userId = readString(value, 'userId');
      const messageId = readString(value, 'messageId');
      return userId && messageId
        ? { ok: true, value: { type, userId, messageId } }
        : { ok: false, error: 'INVALID_SCHEMA' };
    }
    case 'sync:required':
      return parseSyncRequired(value);
    default:
      return { ok: false, error: 'INVALID_SCHEMA' };
  }
};

export const parseBroadcastEvent = (
  raw: string
): Result<BroadcastEvent, 'EMPTY_EVENT' | 'INVALID_JSON' | 'INVALID_SCHEMA'> => {
  if (!raw) return { ok: false, error: 'EMPTY_EVENT' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  return parseBroadcastEventPayload(parsed);
};
