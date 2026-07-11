import { z } from 'zod';

import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import { logger } from '../logger';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  autonomy_enabled: z.boolean().optional(),
});

const agentListSchema = z.array(agentSchema);

export interface AgentInput {
  id?: string;
  name: string;
  description?: string;
  avatar?: string;
  modelId?: string;
  autonomyEnabled: boolean;
  timezone?: string;
  activeStart?: string;
  activeEnd?: string;
  activeDays?: number[];
  checkInterval?: number;
}

export type Agent = z.infer<typeof agentSchema>;

function parseJsonSafe<T>(raw: unknown, schema: z.ZodType<T>): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  logger.warn('API response validation failed', { error: parsed.error.flatten() });
  return err(new Error('Invalid response from server'));
}

export const upsertAgent = async (data: AgentInput): Promise<Result<Agent>> => {
  const agentUrl = '/api/v1/agents';

  try {
    const payload = {
      id: data.id,
      name: data.name,
      description: data.description,
      avatar: data.avatar,
      modelId: data.modelId,
      autonomyEnabled: data.autonomyEnabled,
      timezone: data.timezone ?? 'UTC',
      activeStart: data.activeStart ?? '09:00',
      activeEnd: data.activeEnd ?? '17:00',
      activeDays: data.activeDays ?? [1, 2, 3, 4, 5],
      check_interval: data.checkInterval ?? 600,
    };

    const csrfToken = await getCsrfToken();
    const response = await fetch(agentUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(() => null);

    if (!response.ok) {
      const message = readApiErrorMessage(rawBody) ?? 'Failed to update agent autonomy';
      return err(new Error(message));
    }

    const result = parseJsonSafe(rawBody, agentSchema);
    return result;
  } catch (error) {
    logger.error('Failed to upsert agent', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const fetchAgents = async (): Promise<Result<Agent[]>> => {
  const agentUrl = '/api/v1/agents';

  try {
    const response = await fetch(agentUrl, { credentials: 'include' });
    const rawBody = await response.json().catch(() => null);

    if (!response.ok) {
      const message = readApiErrorMessage(rawBody) ?? 'Failed to fetch agents';
      return err(new Error(message));
    }

    const result = parseJsonSafe(rawBody, agentListSchema);
    return result;
  } catch (error) {
    logger.error('Failed to fetch agents', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
