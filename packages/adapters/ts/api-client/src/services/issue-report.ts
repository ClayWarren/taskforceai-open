'use client';

import type { ReportIssueCategory } from '@taskforceai/client-core/support/reportIssues';

import { reportIssue } from '../api/support';
import { getAuthLogger } from '../auth/logger';
import { readClientMetadata } from './client-metadata';
import { type Result, err, ok } from '@taskforceai/client-core/result';

const logger = getAuthLogger();

export type IssueReportContext = {
  conversationId?: string | null;
  lastMessagePreview?: string;
};

export type IssueMetadata = {
  locale?: string;
  timezone?: string;
  platform?: string;
  appVersion?: string;
  conversationId?: string | null;
  latestMessagePreview?: string;
};

export type IssueReportError = {
  kind: 'submit_failed';
  message: string;
};

export type SubmitIssueParams = {
  category: ReportIssueCategory;
  description: string;
  context?: IssueReportContext;
  appVersion?: string;
};

const buildClientMetadata = (context?: IssueReportContext, appVersion?: string): IssueMetadata => {
  const metadataResult = readClientMetadata();
  const metadata: IssueMetadata = metadataResult.ok ? metadataResult.value : {};

  if (appVersion) {
    metadata.appVersion = appVersion;
  }
  if (context?.conversationId) {
    metadata.conversationId = context.conversationId;
  }
  if (context?.lastMessagePreview) {
    metadata.latestMessagePreview = context.lastMessagePreview.slice(0, 280);
  }
  return metadata;
};

export const submitIssueReport = async (
  params: SubmitIssueParams
): Promise<Result<void, IssueReportError>> => {
  try {
    await reportIssue({
      category: params.category,
      description: params.description,
      metadata: buildClientMetadata(params.context, params.appVersion),
    });
    return ok(undefined);
  } catch (error) {
    logger.error('Failed to submit issue report', { error, category: params.category });
    const message = error instanceof Error ? error.message : 'Unable to submit report';
    return err({ kind: 'submit_failed', message });
  }
};
