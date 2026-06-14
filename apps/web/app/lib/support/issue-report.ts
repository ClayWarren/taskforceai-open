import {
  submitIssueReport,
  type IssueReportContext,
  type IssueMetadata,
  type IssueReportError,
  type SubmitIssueParams,
} from '@taskforceai/contracts';
import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';

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
  params: Omit<import('@taskforceai/contracts').SubmitIssueParams, 'appVersion'>
) => submitIssueReport({ ...params, appVersion: APP_VERSION });
