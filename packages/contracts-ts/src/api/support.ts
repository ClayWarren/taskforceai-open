import { z } from 'zod';

import { getCsrfToken } from '@taskforceai/contracts/auth/csrf';
import { getAuthLogger } from '../auth/logger';

const logger = getAuthLogger();

export type ReportIssuePayload = {
  category: string;
  description: string;
  metadata?: Record<string, unknown> | null;
};

const errorSchema = z.object({
  error: z.string().optional(),
});

export const reportIssue = async (payload: ReportIssuePayload): Promise<void> => {
  const csrfToken = await getCsrfToken();
  const response = await fetch('/api/v1/support/report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({
      category: payload.category,
      description: payload.description,
      metadata: payload.metadata ?? undefined,
    }),
  });

  if (!response.ok) {
    let rawPayload: unknown = {};
    try {
      rawPayload = await response.json();
    } catch (error) {
      logger.warn('Failed to parse support report error response', {
        error,
        status: response.status,
      });
    }
    const parseResult = errorSchema.safeParse(rawPayload);
    const errorMsg =
      parseResult.success && parseResult.data.error
        ? parseResult.data.error
        : 'Unable to submit report';
    throw new Error(errorMsg);
  }

  logger.info('Support issue report submitted');
};
