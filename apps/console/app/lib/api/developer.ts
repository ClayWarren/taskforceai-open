import { z } from 'zod';

import { getCsrfToken } from '../auth/csrf';
import { logger } from '../logger';
import { type Result, err, ok } from '../utils/result';

const apiErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  detail: z.string().optional(),
});

export const apiKeyDataSchema = z.object({
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

export type APIKeyData = z.infer<typeof apiKeyDataSchema>;
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

export const fetchUsageStats = async (): Promise<Result<UsageStats, ApiError>> => {
  try {
    const response = await fetch('/api/v1/developer/usage');
    if (!response.ok) {
      return err({
        kind: 'server',
        message: await readErrorMessage(response),
        status: response.status,
      });
    }
    const json: unknown = await response.json();
    const parsed = usageStatsSchema.safeParse(json);
    if (!parsed.success) {
      logger.error('Developer usage stats payload failed validation', {
        issues: parsed.error.issues,
      });
      return err({
        kind: 'validation',
        message: 'Developer usage stats payload failed validation',
      });
    }
    return ok(parsed.data);
  } catch (error) {
    logger.error('Failed to fetch usage stats', { error });
    return err({ kind: 'network', message: 'Failed to fetch usage stats' });
  }
};

export const createApiKey = async (): Promise<Result<{ apiKey: string }, ApiError>> => {
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/v1/developer/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      return err({
        kind: 'server',
        message: await readErrorMessage(response),
        status: response.status,
      });
    }

    const json: unknown = await response.json();
    const parsed = createApiKeyResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.error('Create API key response failed validation', {
        issues: parsed.error.issues,
      });
      return err({ kind: 'validation', message: 'Create API key response invalid' });
    }
    return ok({ apiKey: parsed.data.apiKey });
  } catch (error) {
    logger.error('Failed to create API key', { error });
    return err({ kind: 'network', message: 'Failed to create API key' });
  }
};

export const revokeApiKey = async (
  keyId: number
): Promise<Result<{ status: 'revoked' }, ApiError>> => {
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/v1/developer/keys', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ keyId }),
    });

    if (!response.ok) {
      return err({
        kind: 'server',
        message: await readErrorMessage(response),
        status: response.status,
      });
    }
    return ok({ status: 'revoked' });
  } catch (error) {
    logger.error('Failed to revoke API key', { error });
    return err({ kind: 'network', message: 'Failed to revoke API key' });
  }
};
