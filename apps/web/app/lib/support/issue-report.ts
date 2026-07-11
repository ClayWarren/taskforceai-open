import {
  submitIssueReport,
  type IssueReportContext,
  type IssueMetadata,
  type IssueReportError,
  type SubmitIssueParams,
} from '@taskforceai/api-client';
import { getRuntimeEnv } from '@taskforceai/config/app-env';

export {
  submitIssueReport,
  type IssueReportContext,
  type IssueMetadata,
  type IssueReportError,
  type SubmitIssueParams,
};

const APP_VERSION =
  getRuntimeEnv('VITE_APP_VERSION') ?? getRuntimeEnv('VITE_VERCEL_GIT_COMMIT_SHA') ?? 'web';

export const submitIssueReportWithVersion = (
  params: Omit<import('@taskforceai/api-client').SubmitIssueParams, 'appVersion'>
) => submitIssueReport({ ...params, appVersion: APP_VERSION });
