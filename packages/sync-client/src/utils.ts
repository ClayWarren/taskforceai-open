import { z } from 'zod';

import { parseJsonSchema } from '@taskforceai/shared/json/parse';
import type { Result } from '@taskforceai/shared/result';
import type { BroadcastEvent } from './types';

const broadcastEventSchema: z.ZodType<BroadcastEvent> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connected'),
    connectionId: z.string(),
  }),
  z.object({
    type: z.literal('conversation:created'),
    userId: z.string(),
    conversationId: z.number(),
  }),
  z.object({
    type: z.literal('conversation:updated'),
    userId: z.string(),
    conversationId: z.number(),
  }),
  z.object({
    type: z.literal('conversation:deleted'),
    userId: z.string(),
    conversationId: z.number(),
  }),
  z.object({
    type: z.literal('message:created'),
    userId: z.string(),
    conversationId: z.number(),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal('message:updated'),
    userId: z.string(),
    conversationId: z.number(),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal('message:deleted'),
    userId: z.string(),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal('sync:required'),
    userId: z.string().optional(),
  }),
]);

export const parseBroadcastEvent = (
  raw: string
): Result<BroadcastEvent, 'EMPTY_EVENT' | 'INVALID_JSON' | 'INVALID_SCHEMA'> => {
  if (!raw) return { ok: false, error: 'EMPTY_EVENT' };
  const parsed = parseJsonSchema(raw, broadcastEventSchema);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error === 'INVALID_JSON' ? 'INVALID_JSON' : 'INVALID_SCHEMA',
    };
  }
  return { ok: true, value: parsed.value };
};
