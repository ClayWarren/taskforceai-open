import {
  submitIssueReport,
  type IssueReportContext,
  type IssueMetadata,
  type IssueReportError,
  type SubmitIssueParams,
} from '@taskforceai/contracts/services/issue-report';
import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';

export {
  submitIssueReport,
  type IssueReportContext,
  type IssueMetadata,
  type IssueReportError,
  type SubmitIssueParams,
};

const APP_VERSION =
  getRuntimeEnv('NEXT_PUBLIC_APP_VERSION') ??
  getRuntimeEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA') ??
  'console';

export const submitIssueReportWithVersion = (params: Omit<SubmitIssueParams, 'appVersion'>) =>
  submitIssueReport({ ...params, appVersion: APP_VERSION });
