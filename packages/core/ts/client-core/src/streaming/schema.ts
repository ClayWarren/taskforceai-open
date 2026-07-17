import { z } from 'zod';

import { parseJsonSchema } from '../json/parse';
import { type Result, err, ok } from '../result';
import type { ToolUsageEvent } from '../types';
import {
  sourceReferenceSchema,
  toolUsageEventSchema as baseToolUsageEventSchema,
} from '../validation';
import type { StreamingPayload, ToolUsageEventPayload } from './types';

const toolUsageEventSchema = baseToolUsageEventSchema.extend({
  timestamp: z.string(),
  image_base64: z.string().optional(),
});

const toolUsageEventPayloadSchema = z
  .object({
    timestamp: z
      .union([
        z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp'),
        z
          .number()
          .finite()
          .refine((value) => Number.isFinite(new Date(value).getTime()), 'Invalid timestamp'),
      ])
      .optional(),
    agent_id: z.number().optional(),
    agent_label: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_output: z.unknown().optional(),
    duration_ms: z.number().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
    image_base64: z.string().optional(),
  })
  .passthrough();

const toolEventSchema = z.union([toolUsageEventSchema, toolUsageEventPayloadSchema]);

const optionalStringFromNullable = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => value ?? undefined);

const optionalNumberFromNullable = z
  .union([z.number(), z.null()])
  .optional()
  .transform((value) => value ?? undefined);

const agentStatusSnapshotSchema = z
  .object({
    status: z.string(),
    agent_id: optionalNumberFromNullable,
    progress: optionalNumberFromNullable,
    result: optionalStringFromNullable,
    reasoning: optionalStringFromNullable,
    model: optionalStringFromNullable,
    sources: z.array(sourceReferenceSchema).optional(),
  })
  .passthrough();

const budgetUsageSchema = z.object({
  initialUsd: z.number().optional(),
  consumedUsd: z.number(),
  remainingUsd: z.number().optional(),
});

const pendingApprovalSchema = z
  .object({
    approvalId: z.string().optional(),
    permission: z.string(),
    agentName: z.string(),
    patterns: z.union([z.array(z.string()), z.null()]).transform((value) => value ?? []),
    metadata: z
      .union([z.record(z.string(), z.unknown()), z.null()])
      .transform((value) => value ?? {}),
  })
  .passthrough();

export const streamingPayloadSchema: z.ZodType<StreamingPayload> = z
  .object({
    type: z.string(),
    agent_statuses: z.array(agentStatusSnapshotSchema).optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    task_id: z.string().optional(),
    prompt: z.string().optional(),
    chunk: z.string().optional(),
    reasoning: z.string().optional(),
    tool_event: toolEventSchema.optional(),
    tool_events: z.array(toolEventSchema).optional(),
    tool_usage: z.array(toolEventSchema).optional(),
    model_id: z.string().optional(),
    model_label: z.string().optional(),
    model_badge: z.string().optional(),
    agent_count: z.number().optional(),
    conversation_id: optionalNumberFromNullable.pipe(z.number().int().optional()),
    trace_id: optionalStringFromNullable,
    pending_approval: z.union([pendingApprovalSchema, z.null()]).optional(),
    budget_usage: budgetUsageSchema.optional(),
  })
  .passthrough();

export const parseStreamingPayload = (
  raw: string
): Result<StreamingPayload, 'INVALID_JSON' | 'INVALID_PAYLOAD'> => {
  if (!raw) return err('INVALID_PAYLOAD');
  const parsed = parseJsonSchema(raw, streamingPayloadSchema);
  if (!parsed.ok) {
    return parsed.error === 'INVALID_JSON' ? err('INVALID_JSON') : err('INVALID_PAYLOAD');
  }
  return ok(parsed.value);
};

export type { ToolUsageEvent, ToolUsageEventPayload };
