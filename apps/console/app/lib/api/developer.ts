import { z } from 'zod';

import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import { logger } from '../logger';
import { consoleMetrics } from '../observability/metrics';
import { type Result, err, ok } from '@taskforceai/client-core/result';

const apiErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  detail: z.string().optional(),
});

const apiKeyDataSchema = z.object({
  keyId: z.number(),
  displayKey: z.string(),
  tier: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  hourlyLimit: z.number(),
  monthlyQuota: z.number(),
  currentHourlyUsage: z.number(),
  dailyUsage: z.number(),
  weeklyUsage: z.number(),
  monthlyUsage: z.number(),
});

export const usageStatsSchema = z.object({
  totalRequests: z.number(),
  requestsThisMonth: z.number(),
  requestsThisWeek: z.number(),
  requestsToday: z.number(),
  monthlyQuota: z.number(),
  monthlyRemaining: z.number(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  apiKeys: z.array(apiKeyDataSchema),
  usageHistory: z.array(z.object({ date: z.string(), count: z.number() })),
});

const createApiKeyResponseSchema = z.object({
  apiKey: z.string(),
  message: z.string().optional(),
});

export type UsageStats = z.infer<typeof usageStatsSchema>;

export type ApiError = {
  kind: 'network' | 'validation' | 'server';
  message: string;
  status?: number;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const raw: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data.error || parsed.data.message || parsed.data.detail || 'Unknown error';
    }
  } catch (error) {
    logger.warn('Failed to parse developer API error payload', {
      error,
      status: response.status,
    });
  }
  return 'Unknown error';
};

const readJsonPayload = async (
  response: Response,
  context: string
): Promise<Result<unknown, ApiError>> => {
  try {
    return ok(await response.json());
  } catch (error) {
    logger.error(`${context} payload was not valid JSON`, {
      error,
      status: response.status,
    });
    return err({
      kind: 'validation',
      message: `${context} payload was not valid JSON`,
      status: response.status,
    });
  }
};

const startDeveloperApiObservation = (
  operation: 'usage' | 'create_key' | 'revoke_key',
  endpoint: string,
  method: string
) => {
  const tags = { operation, endpoint, method };
  consoleMetrics.incrementCounter('developer.api.request.total', tags);
  const stopTimer = consoleMetrics.startTimer('developer.api.request.duration', tags);
  return {
    success(status?: number) {
      consoleMetrics.incrementCounter('developer.api.request.success', { ...tags, status });
    },
    failure(kind: ApiError['kind'], status?: number, error?: unknown) {
      consoleMetrics.incrementCounter('developer.api.request.failure', {
        ...tags,
        kind,
        status,
        ...(error instanceof Error ? { error: error.name } : {}),
      });
    },
    stopTimer,
  };
};

export const fetchUsageStats = async (): Promise<Result<UsageStats, ApiError>> => {
  const observation = startDeveloperApiObservation('usage', '/api/v1/developer/usage', 'GET');
  try {
    const response = await fetch('/api/v1/developer/usage');
    if (!response.ok) {
      observation.failure('server', response.status);
      return err({
        kind: 'server',
        message: await readErrorMessage(response),
        status: response.status,
      });
    }
    const json = await readJsonPayload(response, 'Developer usage stats');
    if (!json.ok) {
      observation.failure(json.error.kind, json.error.status);
      return err(json.error);
    }
    const parsed = usageStatsSchema.safeParse(json.value);
    if (!parsed.success) {
      logger.error('Developer usage stats payload failed validation', {
        issues: parsed.error.issues,
      });
      observation.failure('validation');
      return err({
        kind: 'validation',
        message: 'Developer usage stats payload failed validation',
      });
    }
    observation.success(response.status);
    return ok(parsed.data);
  } catch (error) {
    logger.error('Failed to fetch usage stats', { error });
    observation.failure('network', undefined, error);
    return err({ kind: 'network', message: 'Failed to fetch usage stats' });
  } finally {
    observation.stopTimer();
  }
};

export const createApiKey = async (): Promise<Result<{ apiKey: string }, ApiError>> => {
  const observation = startDeveloperApiObservation('create_key', '/api/v1/developer/keys', 'POST');
  try {
    const csrfToken = await getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/v1/developer/keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      observation.failure('server', response.status);
      return err({
        kind: 'server',
        message: await readErrorMessage(response),
        status: response.status,
      });
    }

    const json = await readJsonPayload(response, 'Create API key response');
    if (!json.ok) {
      observation.failure(json.error.kind, json.error.status);
      return err(json.error);
    }
    const parsed = createApiKeyResponseSchema.safeParse(json.value);
    if (!parsed.success) {
      logger.error('Create API key response failed validation', {
        issues: parsed.error.issues,
      });
      observation.failure('validation');
      return err({ kind: 'validation', message: 'Create API key response invalid' });
    }
    observation.success(response.status);
    return ok({ apiKey: parsed.data.apiKey });
  } catch (error) {
    logger.error('Failed to create API key', { error });
    observation.failure('network', undefined, error);
    return err({ kind: 'network', message: 'Failed to create API key' });
  } finally {
    observation.stopTimer();
  }
};

export const revokeApiKey = async (
  keyId: number
): Promise<Result<{ status: 'revoked' }, ApiError>> => {
  const observation = startDeveloperApiObservation(
    'revoke_key',
    '/api/v1/developer/keys',
    'DELETE'
  );
  try {
    const csrfToken = await getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/v1/developer/keys', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ keyId }),
    });

    if (!response.ok) {
      observation.failure('server', response.status);
      return err({
        kind: 'server',
        message: await readErrorMessage(response),
        status: response.status,
      });
    }
    observation.success(response.status);
    return ok({ status: 'revoked' });
  } catch (error) {
    logger.error('Failed to revoke API key', { error });
    observation.failure('network', undefined, error);
    return err({ kind: 'network', message: 'Failed to revoke API key' });
  } finally {
    observation.stopTimer();
  }
};
